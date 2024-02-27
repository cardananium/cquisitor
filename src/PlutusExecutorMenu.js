import {Box, Button, Input, MenuItem, Select, TextField, Typography} from "@mui/material";
import {useEffect, useRef, useState} from "react";
import {execute_tx_scripts_for_specific_network, get_utxo_list_from_tx, NetworkType} from "cquisitor_wasm"

function mapNetworkTypeToUrl(networkType) {
    switch (networkType) {
        case "mainnet":
            return NetworkType.Mainnet;
        case "preprod":
            return NetworkType.TestnetPreprod;
        case "preview":
            return NetworkType.TestnetPreview;
        default:
            return NetworkType.Mainnet;
    }
}

export const PlutusExecutorMenu = ({show, cborHex, onResult}) => {
    const [networkType, setNetworkType] = useState("");
    const [apiToken, setApiToken] = useState(localStorage.getItem("apiToken") || "Kios API key");
    const [executing, setExecuting] = useState(false);
    const availableNetworks = ['mainnet', 'preprod', 'preview'];

    const executeScripts = async (executionState) => {
        if (!executionState && show) {
            setExecuting(true);
            try {
                onResult("Executing...");
                const result = await execute_tx_scripts_for_specific_network(cborHex, mapNetworkTypeToUrl(networkType), apiToken);
                console.log("result", result)
                onResult(JSON.parse(result));
            } catch (e) {
                console.error("error", e)
                onResult({error: e.toString()});
            }
            setExecuting(false);
        }
    };

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
                Select network type:
            </Typography>
            <Select
                sx={{fontSize: 14}}
                size="small"
                value={networkType}
                onChange={(e) => {
                    setNetworkType(e.target.value);
                }}
            >
                {availableNetworks.map((networkItem) => (
                    <MenuItem sx={{fontSize: 14}} key={networkItem} value={networkItem}>{networkItem}</MenuItem>
                ))}
            </Select>
            <Box sx={{ flexGrow: 1 }} />
            <Input defaultValue={apiToken} onInput={
                (e) => {
                    setApiToken(e.target.value);
                    localStorage.setItem("apiToken", e.target.value);
                }
            } />
            <Button
                disabled={executing}
                variant="contained"
                color="primary"
                onClick={() => {
                    if(executing) return;
                    executeScripts(executing);
                }
                }
                style={{"marginLeft": 18}}
            >
                Execute
            </Button>
        </>
    )
}
