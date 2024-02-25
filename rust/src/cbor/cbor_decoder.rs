use std::convert::TryInto;

use minicbor::data::Tag;
use minicbor::decode::{ExtendedToken, ExtendedTokenizer};
use minicbor::decode::Token;
use minicbor::decode::Decoder;
use minicbor::decode::Error as CborError;
use serde_json::{Number, Value};
use crate::js_error::JsError;

#[derive(Clone, Debug)]
pub struct CborPos {
    offset: usize,
    length: usize,
}

#[derive(Clone, Debug)]
pub enum CborCollection {
    Tag(Option<Value>, Tag, CborPos, CborPos),
    Array(Value, Option<usize>, usize, CborPos, CborPos),
    Map(Value, Option<Value>, Option<usize>, usize, CborPos, CborPos),
}

impl CborCollection {

    pub fn new_array() -> CborCollection {
        CborCollection::Array(Value::Array(Vec::new()), None, 0, CborPos { offset: 0, length: 0 }, CborPos { offset: 0, length: 0 })
    }

    pub fn new_collection(token: &ExtendedToken) -> Result<CborCollection, JsError> {
        let pos = CborPos {
            offset: token.offset,
            length: token.length,
        };

        match token.token {
            Token::BeginArray => Ok(CborCollection::Array(Value::Array(Vec::new()), None, 0, pos.clone(), pos)),
            Token::BeginMap => Ok(CborCollection::Map(Value::Array(Vec::new()), None,None, 0, pos.clone(), pos)),
            Token::Array(len) => Ok(CborCollection::Array(Value::Array(Vec::new()), Some(len as usize), 0, pos.clone(), pos)),
            Token::Map(len) => Ok(CborCollection::Map(Value::Array(Vec::new()), None, Some(len as usize), 0, pos.clone(), pos)),
            Token::Tag(tag) => Ok(CborCollection::Tag(None, tag, pos.clone(), pos)),
            _ => Err(JsError::new("Invalid token")),
        }
    }

    pub fn add_value(&mut self, new_value: Value, value_pos: &CborPos, finalizer: bool) -> Result<(), JsError> {
        match self {
            CborCollection::Array(array, len, count, _, total_size) => {
                if let Some(len) = len {
                    if *count >= *len {
                        return Err(JsError::new("Array is full"));
                    }
                }
                let array = array.as_array_mut().ok_or(JsError::new("Invalid array"))?;
                array.push(new_value);
                if !finalizer {
                    *count += 1;
                }
                *total_size = extend_pos(total_size, value_pos);
                Ok(())
            },
            CborCollection::Map(map, key, len, count, _, total_size) => {
                if let Some(len) = len {
                    if *count >= *len {
                        return Err(JsError::new("Map is full"));
                    }
                }

                if key.is_none() {
                    *key = Some(new_value.clone());
                    return Ok(());
                }

                let map = map.as_array_mut().ok_or(JsError::new("Invalid array"))?;
                map.push(build_map_value(key.clone().unwrap(), new_value));
                if !finalizer {
                    *count += 1;
                }
                *total_size = extend_pos(total_size, value_pos);
                *key = None;
                Ok(())
            },
            CborCollection::Tag(value, _, _, total_size) => {
                if let Some(_) = value {
                    return Err(JsError::new("Tag already has a value"));
                }
                *value = Some(new_value);
                *total_size = extend_pos(total_size, value_pos);
                Ok(())
            },
        }
    }

    pub fn is_collection_finished(&self) -> bool {
        match self {
            CborCollection::Array(_, Some(len), count, _, _) => *count >= *len,
            CborCollection::Map(_, _, Some(len), count, _, _) => *count >= *len,
            CborCollection::Tag(Some(_), _, _, _) => true,
            _ => false,
        }
    }

    pub fn to_value(self) -> Result<Value, JsError> {
        match self {
            CborCollection::Array(array, length, _, pos, full_struct_pos) => {
                let mut map = serde_json::Map::new();
                let position_info = cbor_pos_to_value(&pos);
                let full_position_info = cbor_pos_to_value(&full_struct_pos);
                let length = match length {
                    Some(len) => Value::Number(Number::from(len as u64)),
                    None => Value::String("Indefinite".into()),
                };
                map.insert(String::from("type"), Value::String(String::from("array")));
                map.insert(String::from("items"), length);
                map.insert(String::from("position_info"), position_info);
                map.insert(String::from("struct_position_info"), full_position_info);
                map.insert(String::from("values"), array);
                Ok(Value::Object(map))
            },
            CborCollection::Map(array, _, length, _, pos, full_struct_pos) => {
                let mut map = serde_json::Map::new();
                let length = match length {
                    Some(len) => Value::Number(Number::from(len as u64)),
                    None => Value::String("Indefinite".into()),
                };
                let position_info = cbor_pos_to_value(&pos);
                let full_position_info = cbor_pos_to_value(&full_struct_pos);
                map.insert(String::from("type"), Value::String(String::from("map")));
                map.insert(String::from("items"), length);
                map.insert(String::from("position_info"), position_info);
                map.insert(String::from("struct_position_info"), full_position_info);
                map.insert(String::from("values"), array);
                Ok(Value::Object(map))
            },
            CborCollection::Tag(value, tag, pos, full_struct_pos) => {
                let mut map = serde_json::Map::new();
                let value = value.clone().ok_or(JsError::new("Tag has no value"))?;
                let position_info = cbor_pos_to_value(&pos);
                let full_position_info = cbor_pos_to_value(&full_struct_pos);
                map.insert(String::from("type"), Value::String(String::from("tag")));
                map.insert(String::from("position_info"), position_info);
                map.insert(String::from("struct_position_info"), full_position_info);
                map.insert(String::from("tag"), Value::String(get_tag_name(&tag)));
                map.insert(String::from("value"), value);
                Ok(Value::Object(map))
            },
        }
    }

    pub fn to_simple_value(self) -> Value {
        match self {
            CborCollection::Array(array, _, _, _, _) => array,
            CborCollection::Map(array, _, _, _, _, _) => array,
            CborCollection::Tag(value, _, _, _) => value.unwrap_or(Value::Null),
        }
    }

    pub fn get_full_pos(&self) -> CborPos {
        match self {
            CborCollection::Array(_, _, _, _, total_size) => total_size.clone(),
            CborCollection::Map(_, _, _, _, _, total_size) => total_size.clone(),
            CborCollection::Tag(_, _, _, total_size) => total_size.clone(),
        }
    }
}

pub fn extend_pos(struct_pos: &CborPos, value_pos: &CborPos) -> CborPos {
    let value_end = value_pos.offset + value_pos.length;
    let struct_end = struct_pos.offset + struct_pos.length;
    if value_end > struct_end {
        CborPos {
            offset: struct_pos.offset,
            length: value_end - struct_pos.offset,
        }
    } else {
        struct_pos.clone()
    }
}

pub fn get_tokenizer(data: &[u8]) -> ExtendedTokenizer {
    Decoder::new(data).into()
}

pub fn get_value(tokenizer: ExtendedTokenizer) -> Result<Value, JsError> {
    let mut collections = Vec::<CborCollection>::new();
    let root_collection = CborCollection::new_array();
    collections.push(root_collection);

    for token in tokenizer {
        let token = token.map_err(|err|  minicbor_to_js_error(err))?;

        let token_pos = CborPos {
            offset: token.offset,
            length: token.length,
        };

        collections = collapse_collections(collections)?;

        if is_collection_finished(&token.token) {
            let mut last_collection = collections.pop().unwrap();
            let finalizer = extended_token_to_value(&token, &token_pos)?;
            last_collection.add_value(finalizer, &token_pos, true)?;
            let collection_pos = last_collection.get_full_pos();
            collections.last_mut().unwrap().add_value(
                last_collection.to_value()?,
                &collection_pos,
                false)?;
            continue;
        }

        collections = collapse_collections(collections)?;

        if is_token_collection(&token.token) {
            let new_collection = CborCollection::new_collection(&token)?;
            collections.push(new_collection);
            continue;
        }

        let new_value = extended_token_to_value(&token, &token_pos)?;
        collections.last_mut().unwrap().add_value(new_value, &token_pos, false)?;
    }

    collections = collapse_collections(collections)?;

    if collections.len() != 1 {
        return Err(JsError::new("Invalid CBOR"));
    }

    Ok(collections.pop().unwrap().to_simple_value())
}

pub fn collapse_collections(mut collections: Vec<CborCollection>) -> Result<Vec<CborCollection>, JsError> {
    while collections.last().unwrap().is_collection_finished() {
        let last_collection = collections.pop().unwrap();
        let collection_pos = last_collection.get_full_pos();
        collections.last_mut().unwrap().add_value(
            last_collection.to_value()?,
            &collection_pos,
            false)?;
    }
    Ok(collections)
}

pub fn is_token_collection(token: &Token) -> bool {
    match token {
        Token::Array(_) => true,
        Token::Map(_) => true,
        Token::BeginArray => true,
        Token::BeginMap => true,
        Token::Tag(_) => true,
        _ => false,
    }
}

pub fn get_collection_length(token: &Token) -> Option<u64> {
    match token {
        Token::Array(len) => Some(*len),
        Token::Map(len) => Some(*len),
        Token::BeginArray => None,
        Token::BeginMap => None,
        _ => None,
    }
}

pub fn is_collection_finished(token: &Token) -> bool {
    match token {
        Token::Break => true,
        _ => false,
    }
}

pub fn cbor_pos_to_value(pos: &CborPos) -> Value {
    let mut map = serde_json::Map::new();
    let offset = Value::Number(pos.offset.into());
    let length = Value::Number(pos.length.into());
    map.insert(String::from("offset"), offset);
    map.insert(String::from("length"), length);
    Value::Object(map)
}

pub fn extended_token_to_value(token: &ExtendedToken, pos: &CborPos) -> Result<Value, JsError> {
    let mut map = serde_json::Map::new();
    let position_info = cbor_pos_to_value(pos);
    let token_type = Value::String(get_token_name(&token.token));
    let token_value = token_to_value(&token.token)?;
    map.insert(String::from("position_info"), position_info);
    map.insert(String::from("type"), token_type);
    map.insert(String::from("value"), token_value);
    Ok(Value::Object(map))
}

pub fn token_to_value(token: &Token) -> Result<Value, JsError> {
    match *token {
        Token::Null => Ok(Value::Null),
        Token::Bool(b) => Ok(Value::Bool(b.clone())),
        Token::U8(u) => Ok(Value::Number(u.into())),
        Token::U16(u) => Ok(Value::Number(u.into())),
        Token::U32(u) => Ok(Value::Number(u.into())),
        Token::U64(u) => Ok(Value::Number(u.into())),
        Token::I8(i) => Ok(Value::Number(i.into())),
        Token::I16(i) => Ok(Value::Number(i.into())),
        Token::I32(i) => Ok(Value::Number(i.into())),
        Token::I64(i) => Ok(Value::Number(i.into())),
        Token::Int(i) => Ok(Value::Number(<minicbor::data::Int as TryInto<u64>>::try_into(i).unwrap().into())),
        Token::F16(f) => Ok(Value::Number(Number::from_f64(f.into()).unwrap())),
        Token::F32(f) => Ok(Value::Number(Number::from_f64(f.into()).unwrap())),
        Token::F64(f) => Ok(Value::Number(Number::from_f64(f.into()).unwrap())),
        Token::Bytes(b) => Ok(Value::String(hex::encode(b))),
        Token::String(t) => Ok(Value::String(t.to_string())),
        Token::Simple(s) => Ok(Value::Number(s.into())),
        Token::Undefined => Ok(Value::Null),
        Token::Break => Ok(Value::Null),
        _ => Err(JsError::new("Token is not a value")),
    }
}

pub fn get_token_name(token: &Token) -> String {
    match token {
        Token::Null => String::from("Null"),
        Token::Bool(_) => String::from("Bool"),
        Token::U8(_) => String::from("U8"),
        Token::U16(_) => String::from("U16"),
        Token::U32(_) => String::from("U32"),
        Token::U64(_) => String::from("U64"),
        Token::I8(_) => String::from("I8"),
        Token::I16(_) => String::from("I16"),
        Token::I32(_) => String::from("I32"),
        Token::I64(_) => String::from("I64"),
        Token::Int(_) => String::from("Int"),
        Token::F16(_) => String::from("F16"),
        Token::F32(_) => String::from("F32"),
        Token::F64(_) => String::from("F64"),
        Token::Bytes(_) => String::from("Bytes"),
        Token::String(_) => String::from("String"),
        Token::Simple(_) => String::from("Simple"),
        Token::Undefined => String::from("Undefined"),
        Token::BeginArray => String::from("BeginArray"),
        Token::BeginMap => String::from("BeginMap"),
        Token::BeginString => String::from("BeginString"),
        Token::BeginBytes => String::from("BeginBytes"),
        Token::Break => String::from("Break"),
        Token::Array(_) => String::from("Array"),
        Token::Map(_) => String::from("Map"),
        Token::Tag(_) => String::from("Tag"),
    }
}

pub fn get_tag_name(tag: &Tag) -> String {
    match tag {
        Tag::DateTime => String::from("DateTime"),
        Tag::Timestamp => String::from("Timestamp"),
        Tag::PosBignum => String::from("PosBignum"),
        Tag::NegBignum => String::from("NegBignum"),
        Tag::Decimal => String::from("Decimal"),
        Tag::Bigfloat => String::from("Bigfloat"),
        Tag::ToBase64Url => String::from("ToBase64Url"),
        Tag::ToBase64 => String::from("ToBase64"),
        Tag::ToBase16 => String::from("ToBase16"),
        Tag::Cbor => String::from("Cbor"),
        Tag::Uri => String::from("Uri"),
        Tag::Base64Url => String::from("Base64Url"),
        Tag::Base64 => String::from("Base64"),
        Tag::Regex => String::from("Regex"),
        Tag::Mime => String::from("Mime"),
        Tag::Unassigned(u) => format!("Unassigned({})", u),
    }
}

pub fn to_js_error(error: CborError) -> JsError {
    JsError::new(&format!("{:?}", error))
}

pub fn minicbor_to_js_error(error: minicbor::decode::Error) -> JsError {
    JsError::new(&format!("{:?}", error))
}

pub fn fromhex_to_js_error(error: hex::FromHexError) -> JsError {
    JsError::new(&format!("{:?}", error))
}

pub fn build_map_value(key: Value, value: Value) -> Value {
    let mut map = serde_json::Map::new();
    map.insert(String::from("key"), key);
    map.insert(String::from("value"), value);
    Value::Object(map)
}