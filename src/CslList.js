import * as CSL from "@emurgo/cardano-serialization-lib-browser";
import {MenuItem, Select, Typography} from "@mui/material";
import {useState} from "react";


const cslDecoders = getCslDecoders();
const types = Object.keys(cslDecoders);

//https://stackoverflow.com/a/75567955
function isClass(obj) {

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

function getCslDecoders() {
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
    if(hex !== null && typeof hex === "string" && cslDecoders.hasOwnProperty(typeName)) {
        const object = cslDecoders[typeName](hex);
        const json = object.to_json();
        object.free();
        return json;
    } else {
        return {};
    }
}

export const CslList = ({show, onChoose}) => {
    const [cslType, setCslType] = useState("");
    const [networkType, setNetworkType] = useState("");

    if (show) {
        return null;
    }

    return (
        <>
            <Typography
                variant="h7"
                sx={{
                    mr: 2,
                }}
                style={{"marginLeft": 18}}
            >
                Select CSL type:
            </Typography>
            <Select
                sx={{fontSize: 14}}
                size="small"
                value={cslType}
                onChange={(e) => {
                    setCslType(e.target.value);
                    onChoose(e.target.value, networkType);
                }}
            >
                {types.map((typeName) => <MenuItem sx={{fontSize: 14}} key={typeName} value={typeName}>{typeName}</MenuItem>)}
            </Select>
            <Typography
                variant="h7"
                sx={{
                    mr: 2,
                }}
                style={{"marginLeft": 18}}
            >
                Select network type:
            </Typography>
            <Select
                sx={{fontSize: 14}}
                size="small"
                value={networkType}
                onChange={(e) => {
                    setNetworkType(e.target.value);
                    onChoose(cslType, e.target.value);
                }}
            >
                <MenuItem sx={{fontSize: 14}} key="mainnet" value="mainnet">mainnet</MenuItem>
                <MenuItem sx={{fontSize: 14}} key="preprod" value="preprod">preprod</MenuItem>
                <MenuItem sx={{fontSize: 14}} key="preview" value="preview">preview</MenuItem>
            </Select>
        </>
    )
}