import {Button, MenuItem, Select, Typography} from "@mui/material";
import {useState} from "react";

export const PlutusExecutorMenu = ({show, onExecute}) => {
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
            <Button
                variant="contained"
                color="primary"
                onClick={() => onExecute(networkType)}
                style={{"marginLeft": 18}}
            >
                Execute
            </Button>
        </>
    )
}
