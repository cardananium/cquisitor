import {MenuItem, Select, Typography} from "@mui/material";
import {useState} from "react";
import {getCslDecoders} from "./tools/cls-helpers";


const cslDecoders = getCslDecoders();
const types = Object.keys(cslDecoders);

export const CslList = ({show, onChoose}) => {
    const [cslType, setCslType] = useState("");
    const [networkType, setNetworkType] = useState("");
    const availableNetworks = ['mainnet', 'preprod', 'preview'];

    if (!show) {
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
                {availableNetworks.map((networkItem) => (
                    <MenuItem sx={{fontSize: 14}} key={networkItem} value={networkItem}>{networkItem}</MenuItem>
                ))}
            </Select>
        </>
    )
}