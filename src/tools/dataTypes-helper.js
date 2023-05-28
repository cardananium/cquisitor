import {Link} from "@mui/material";
import {defineDataType} from "@textea/json-viewer";


export function mapNetworkName(networkName, dataType, data) {
    if (networkName === "mainnet" || typeof networkName !== "string" || networkName.length === 0) {
        return ["https://cardanoscan.io/", dataType, '/', data].join('');
    }
    return ["https://", networkName, ".cardanoscan.io/", dataType, '/', data].join('');
}


export const getPositionDataType = (setCborPositionFunction) => defineDataType({
    is: (value, path) =>
        typeof value === 'object' &&
        (path[path.length - 1] === "position_info" || path[path.length - 1] === "struct_position_info"),
    Component: (props) => <Link component="button"
                                variant="body3"
                                onClick={() => {
                                    setCborPositionFunction([props.value.offset, props.value.length])
                                }}>
        offset: {props.value.offset}, length: {props.value.length} (click)</Link>
});

export const getTxIdDataType = (networkType) => defineDataType({
    is: (value, path) =>
        typeof value === 'string' && (path[path.length - 1] === "transaction_id"),
    Component: (props) => <Link
        variant="body3"
        target="_blank"
        href={mapNetworkName(networkType, "transaction", props.value)}>
        <span style={{overflowWrap: "anywhere"}} >{props.value}</span>
    </Link>
});

export const getTxAddressDataType = (networkType) => defineDataType({
    is: (value, path) =>
        typeof value === 'string' && (path[path.length - 1] === "address"),
    Component: (props) => <Link
        variant="body3"
        target="_blank"
        href={mapNetworkName(networkType, "address", props.value)}>
        <span style={{overflowWrap: "anywhere"}} >{props.value}</span>
    </Link>
});