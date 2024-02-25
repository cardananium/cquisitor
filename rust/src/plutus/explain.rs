use pallas::ledger::primitives::babbage::{Constr, PlutusData};
use serde_json::json;
use serde_json::value::Value;
use std::ascii::escape_default;
use pallas::ledger::primitives::babbage;
use uplc::ast::{DeBruijn, NamedDeBruijn};
use uplc::{
    ast::{Constant, Program, Term, Type},
};
use blst::*;

pub fn to_json_program(program: &Program<NamedDeBruijn>) -> String {
    let version = format!(
        "{}.{}.{}",
        program.version.0, program.version.1, program.version.2
    );
    let mut program_json = serde_json::Map::new();
    let mut json = serde_json::Map::new();
    json.insert("version".to_string(), Value::String(version));
    json.insert("term".to_string(), to_json_term(&program.term));
    program_json.insert("program".to_string(), Value::Object(json));
    json!(&program_json).to_string()
}

pub fn to_json_term(term: &Term<NamedDeBruijn>) -> Value {
    match term {
        Term::Var(name) => json!({
            "var": name.text
        }),
        Term::Delay(term) => json!({ "delay": to_json_term(term) }),
        Term::Lambda {
            parameter_name,
            body,
        } => json!({
            "lambda": {
                "parameter_name": parameter_name.text,
                "body": to_json_term(body)
            }
        }),
        Term::Apply { function, argument } => json!({
            "apply": {
                "function": to_json_term(function),
                "argument": to_json_term(argument)
            }
        }),
        Term::Constant(constant) => json!({ "constant": to_json_constant(constant) }),
        Term::Force(term) => json!({ "force": to_json_term(term) }),
        Term::Error => json!({
            "error": "error"
        }),
        Term::Builtin(builtin) => json!({
            "builtin": builtin.to_string()
        }),
        Term::Constr { tag, fields } => json!({
            "constr": {
                "tag": tag,
                "fields": fields.iter().map(to_json_term).collect::<Vec<Value>>()
            }
        }),
        Term::Case { constr, branches } => json!({
            "case": {
                "constr": to_json_term(constr),
                "branches": branches.iter().map(to_json_term).collect::<Vec<Value>>()
            }
        }),
    }
}

fn bigint_to_json(bigint: &babbage::BigInt) -> Value {
    match bigint {
        babbage::BigInt::Int(x) => json!({ "int": x }),
        babbage::BigInt::BigUInt(x) => json!({ "big_uint": x.to_string() }),
        babbage::BigInt::BigNInt(x) => json!({ "big_nint": x.to_string() }),
    }
}

fn to_json_constant(constant: &Constant) -> Value {
    match constant {
        Constant::Integer(i) => json!({ "integer": i.to_string() }),
        Constant::ByteString(bs) => json!({ "bytestring": hex::encode(bs) }),
        Constant::String(s) => json!({ "string": s }),
        Constant::Unit => json!({ "unit": "()" }),
        Constant::Bool(b) => json!({ "bool": b }),
        Constant::ProtoList(r#type, items) => json!({
            "list": {
                "type": to_json_type(&r#type),
                "items": items.iter().map(to_json_constant).collect::<Vec<Value>>()
            }
        }),
        Constant::ProtoPair(type_left, type_right, left, right) => json!({
            "pair": {
                "type_left": to_json_type(type_left),
                "type_right": to_json_type(type_right),
                "left": to_json_constant(left),
                "right": to_json_constant(right)
            }
        }),
        Constant::Data(d) => json!({ "data": to_json_plutus_data(d) }),
        Constant::Bls12_381G1Element(p1) => {
            json!({ "bls12_381_G1_element": json!({ "x": p1.x.l, "y": p1.y.l, "z": p1.z.l }) })
        }
        Constant::Bls12_381G2Element(p2) => {

            json!({ "bls12_381_G2_element": json_blst_p2(p2) })
        }
        Constant::Bls12_381MlResult(_) => panic!("cannot represent Bls12_381MlResult as json"),
    }
}

fn json_blst_p2(p1: &blst_p2) -> Value {
    json!({
        "x": to_json_blst_fp2(&p1.x),
        "y": to_json_blst_fp2(&p1.y),
        "z": to_json_blst_fp2(&p1.z),
    })
}

fn to_json_blst_fp2(fp2: &blst_fp2) -> Value {
    let mut first_level = Vec::new();
    for fp in &fp2.fp {
        first_level.push(json!(fp.l));
    }
    Value::Array(first_level)
}



// This feels a little awkward here; not sure if it should be upstreamed to pallas
fn to_json_plutus_data(data: &PlutusData) -> Value {
    match data {
        PlutusData::Constr(Constr {
            tag,
            any_constructor,
            fields,
        }) => json!({
            "constr": {
                "tag": tag,
                "any_constructor": any_constructor,
                "fields": fields.iter().map(to_json_plutus_data).collect::<Vec<Value>>()
            }
        }),
        PlutusData::Map(kvp) => json!({
            "map": kvp.iter().map(|(key, value)| {
                json!({
                    "key": to_json_plutus_data(key),
                    "value": to_json_plutus_data(value)
                })
            }).collect::<Vec<Value>>()
        }),
        PlutusData::BigInt(bi) => json!({ "integer": bi }),
        PlutusData::BoundedBytes(bs) => json!({ "bytestring": hex::encode(bs.to_vec()) }),
        PlutusData::Array(a) => json!({
            "list": a.iter().map(to_json_plutus_data).collect::<Vec<Value>>()
        }),
    }
}


fn to_json_type(term_type: &Type) -> Value {
    match term_type {
        Type::Bool => json!("bool"),
        Type::Integer => json!("integer"),
        Type::String => json!("string"),
        Type::ByteString => json!("bytestring"),
        Type::Unit => json!("unit"),
        Type::List(r#type) => json!({
            "list": to_json_type(r#type)
        }),
        Type::Pair(l, r) => json!({
            "pair": {
                "left": to_json_type(l),
                "right": to_json_type(r)
            }
        }),
        Type::Data => json!("data"),
        Type::Bls12_381G1Element => json!("bls12_381_G1_element"),
        Type::Bls12_381G2Element => json!("bls12_381_G2_element"),
        Type::Bls12_381MlResult => json!("bls12_381_mlresult"),
    }
}