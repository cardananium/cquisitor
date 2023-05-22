import * as CSL from "@emurgo/cardano-serialization-lib-browser";
import {MenuItem, Select, Typography} from "@mui/material";
import {useState} from "react";


const cslDecoders = getCslDecoders();
const types = Object.keys(cslDecoders);

function getCslDecoders() {
    const classDictionary = {};
    for (let key in CSL) {
        let item = CSL[key];

        if (typeof item === 'function' && /(^|\s)class\s/.test(Function.prototype.toString.call(item))) {
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
                variant="h6"
                sx={{
                    mr: 2,
                }}
                style={{"marginLeft": 18}}
            >
                Select CSL type:
            </Typography>
            <Select
                size="small"
                value={cslType}
                onChange={(e) => {
                    setCslType(e.target.value);
                    onChoose(e.target.value, networkType);
                }}
            >
                {types.map((typeName) => <MenuItem key={typeName} value={typeName}>{typeName}</MenuItem>)}
            </Select>
            <Typography
                variant="h6"
                sx={{
                    mr: 2,
                }}
                style={{"marginLeft": 18}}
            >
                Select network type:
            </Typography>
            <Select
                size="small"
                value={networkType}
                onChange={(e) => {
                    setNetworkType(e.target.value);
                    onChoose(cslType, e.target.value);
                }}
            >
                <MenuItem key="mainnet" value="mainnet">mainnet</MenuItem>
                <MenuItem key="preprod" value="preprod">preprod</MenuItem>
                <MenuItem key="preview" value="preview">preview</MenuItem>
            </Select>
        </>
    )
}