import * as CSL from "@emurgo/cardano-serialization-lib-browser";
import {
    decode_plutus_script_with_extended_info,
    decode_plutus_data,
    decode_address_with_extended_info,
    decode_native_script_with_extended_info,
} from "cquisitor_wasm";

//https://stackoverflow.com/a/75567955
export function isClass(obj) {

    // if not a function, return false.
    if (typeof obj !== 'function') return false;

    // ⭐ is a function, has a `prototype`, and can't be deleted!

    // ⭐ although a function's prototype is writable (can be reassigned),
    //   it's not configurable (can't update property flags), so it
    //   will remain writable.
    //
    // ⭐ a class's prototype is non-writable.
    //
    // Table: property flags of function/class prototype
    // ---------------------------------
    //   prototype  write  enum  config
    // ---------------------------------
    //   function     v      .      .
    //   class        .      .      .
    // ---------------------------------
    const descriptor = Object.getOwnPropertyDescriptor(obj, 'prototype');

    // ❗functions like `Promise.resolve` do have NO `prototype`.
    //   (I have no idea why this is happening, sorry.)
    if (!descriptor) return false;

    return !descriptor.writable;
}

export function getCslDecoders() {
    const classDictionary = {};
    for (let key in CSL) {
        let item = CSL[key];

        if (isClass(item)) {
            const decoders = get_decoders_for_type(key, item);
            if (decoders.length > 0) {
                classDictionary[key] = (data, schema) => decoderForType(data, schema, decoders);
            }
        }
    }
    return classDictionary
}

function get_decoders_for_type(typeName, classObj) {
    switch (typeName) {
        case "PlutusScript":
            return [ decode_plutus_script_with_extended_info, (hex) => decodeToJson(hex, classObj["from_hex"])]
        case "PlutusData":
            return [ (hex, schemaType) => decode_plutus_data(hex, mapSchemaType(schemaType)), (hex) => decodeToJson(hex, classObj["from_hex"])]
        case "Address":
            return [
                decode_address_with_extended_info,
                (bech) => decodeToJson(bech, classObj["from_bech32"]),
                (hex) => decodeToJson(hex, classObj["from_hex"])
            ]
        case "NativeScript":
            return [ decode_native_script_with_extended_info,  (hex) => decodeToJson(hex, classObj["from_hex"])]
    }
    let decoders = []

    if (Object.hasOwn(classObj, 'from_bech32') && Object.hasOwn(classObj.prototype, 'to_json')) {
        decoders.push((bech) => decodeToJson(bech, classObj["from_bech32"]));
    }

    if (Object.hasOwn(classObj, 'from_hex') && Object.hasOwn(classObj.prototype, 'to_json')) {
        decoders.push((hex) => decodeToJson(hex, classObj["from_hex"]));
    }

    return decoders;
}

function decodeToJson(data, constructor) {
    const object = constructor(data);
    const json = object.to_json();
    object.free();
    return json;
}

function decoderForType(data, schema, decoders) {
    let lastError = null;

    for(let i = 0; i < decoders.length; i++) {
        try {
            return decoders[i](data, schema);
        } catch (e) {
            lastError = e;
        }
    }

    if(lastError !== null) {
        throw lastError;
    }
}

function mapSchemaType(typeStr) {
    switch (typeStr) {
        case "BasicConversions":
            return 0;
        case "DetailedSchema":
            return 1;
        default:
            return 0;
    }
}

export function cslDecode(dataString, typeName, schemaType) {
    if(dataString !== null && typeof dataString === "string" && getCslDecoders().hasOwnProperty(typeName)) {
        return getCslDecoders()[typeName](dataString, schemaType);
    } else {
        return {};
    }
}