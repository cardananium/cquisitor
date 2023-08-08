import {MenuItem, Select, Typography} from "@mui/material";
import {useState} from "react";
import {getCslDecoders} from "./tools/cls-helpers";

const types = Object.keys(getCslDecoders());

export const CslList = ({show, onChoose}) => {
    const [cslType, setCslType] = useState("");
    const [networkType, setNetworkType] = useState("");
    const [datumSchemaType, setDatumSchemaType] = useState("BasicConversions");
    const availableNetworks = ['mainnet', 'preprod', 'preview'];
    const datumSchemaTypes = ['BasicConversions', 'DetailedSchema'];

    if (!show) {
        return null;
    }

    let plutusSchema = null;
    if (cslType === "PlutusData") {
        plutusSchema = () => (
            <>
                <Typography
                    variant="h7"
                    sx={{
                        mr: 2,
                    }}
                    style={{"marginLeft": 18}}
                >
                    Schema:
                </Typography>
                <Select
                    sx={{fontSize: 14}}
                    size="small"
                    value={datumSchemaType}
                    onChange={(e) => {
                        setDatumSchemaType(e.target.value);
                        onChoose(cslType, networkType, e.target.value);
                    }}
                >
                    {datumSchemaTypes.map((schemaType) => (
                        <MenuItem sx={{fontSize: 14}} key={schemaType} value={schemaType}>{schemaType}</MenuItem>
                    ))}
                </Select>
            </>
        )
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
                    onChoose(e.target.value, networkType, datumSchemaType);
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
                    onChoose(cslType, e.target.value, datumSchemaType);
                }}
            >
                {availableNetworks.map((networkItem) => (
                    <MenuItem sx={{fontSize: 14}} key={networkItem} value={networkItem}>{networkItem}</MenuItem>
                ))}
            </Select>
            {plutusSchema && plutusSchema()}
        </>
    )
}