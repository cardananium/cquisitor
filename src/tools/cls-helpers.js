import * as CSL from "@emurgo/cardano-serialization-lib-browser";

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
            if (Object.hasOwn(item, 'from_hex')) {
                classDictionary[key] = item["from_hex"];
            }
        }
    }
    return classDictionary
}

export function cslDecode(hex, typeName) {
    if(hex !== null && typeof hex === "string" && getCslDecoders().hasOwnProperty(typeName)) {
        const object = getCslDecoders()[typeName](hex);
        const json = object.to_json();
        object.free();
        return json;
    } else {
        return {};
    }
}