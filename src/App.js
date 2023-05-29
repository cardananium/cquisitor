import './App.css';
import SplitPane from 'react-split-pane';
import {CborInput} from "./CborInput";
import {CslList} from "./CslList";
import {useState} from "react";
import {JsonViewer} from "@textea/json-viewer";
import {
    AppBar,
    Container,
    Grid,
    MenuItem,
    Select,
    Toolbar,
    Typography
} from "@mui/material";
import {ThemeProvider, createTheme} from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import {cbor_to_json} from 'cquisitor_wasm'
import {cslDecode} from './tools/cls-helpers';
import {getPositionDataType, getTxAddressDataType, getTxIdDataType} from './tools/dataTypes-helper';

const darkTheme = createTheme({
    palette: {
        mode: 'dark',
    },
});

const lightTheme = createTheme({
    palette: {
        mode: 'light',
    },
});

const object_stub = {
    message1: "Welcome",
    message2: "This is tool to code CBOR into JSON representation. Just put your CBOR hex on the right side",
    message3: "You can also decode CBOR by cardano-serilization-lib. Choose that option on the top list to use it"
};

function decode(decoderType, cslType, hex) {
    try {

        if (!hex.match("^[0-9A-Fa-f]+$")) {
            return {decode_error: "String must be hex"};
        }

        if (decoderType === 0) {
            return JSON.parse(cbor_to_json(hex));
        }

        if (cslType === null) {
            return {decode_error: "You need to choose a CSL type"};
        }

        return JSON.parse(cslDecode(hex, cslType));
    } catch (e) {
        return {decode_error: e.toString()};
    }
}

function App() {
    const [cborHex, setCborHex] = useState("");
    const [cborPosition, setCborPosition] = useState([0, 0]);
    const [decoderType, setDecoderType] = useState(0);
    const [cslType, setCslType] = useState(null);
    const [networkType, setNetworkType] = useState(null);
    const [currentJson, setCurrentJson] = useState(object_stub);

    return (
        <ThemeProvider theme={lightTheme}>
            <CssBaseline/>
            <Grid container spacing={1}>
                <Grid item xs={12}>
                    <ThemeProvider theme={darkTheme}>
                        <AppBar position="static">
                            <Container maxWidth="xl">
                                <Toolbar disableGutters>
                                    <Typography
                                        variant="h5"
                                        noWrap
                                        component="a"
                                        sx={{
                                            mr: 2,
                                            display: {xs: 'none', md: 'flex'},
                                            fontFamily: 'monospace',
                                            fontWeight: 700,
                                            letterSpacing: '.3rem',
                                            color: 'inherit',
                                            textDecoration: 'none',
                                        }}
                                    >
                                        CQUISITOR
                                    </Typography>
                                    <Typography
                                        variant="h7"
                                        sx={{
                                            mr: 2,
                                        }}
                                    >
                                        Select tool:
                                    </Typography>
                                    <Select
                                        sx={{fontSize: 14}}
                                        size="small"
                                        value={decoderType}
                                        onChange={(e) => {
                                            setDecoderType(e.target.value);
                                            setCborPosition([0, 0]);
                                            setCurrentJson(decode(e.target.value, cslType, cborHex));
                                        }}
                                    >
                                        <MenuItem sx={{fontSize: 14}} value={0}>CBOR to JSON</MenuItem>
                                        <MenuItem sx={{fontSize: 14}} value={1}>Decode by CSL</MenuItem>
                                    </Select>
                                    <CslList show={decoderType === 0} onChoose={(newCslType, newNetworkType) => {
                                        if (newCslType !== cslType || newNetworkType !== networkType) {
                                            setCslType(newCslType);
                                            setNetworkType(newNetworkType);
                                            setCborPosition([0, 0]);
                                            setCurrentJson(decode(decoderType, newCslType, cborHex));
                                        }
                                    }}/>
                                </Toolbar>
                            </Container>
                        </AppBar>
                    </ThemeProvider>
                </Grid>
                <Grid item xs={12}>
                    <div className="container">
                        <SplitPane split="vertical" minSize={400} defaultSize="50%">
                            <div className="left-col">
                                <CborInput position={cborPosition} onChange={(x) => {
                                    if (cborHex !== x) {
                                        setCborHex(x);
                                        setCborPosition([0, 0]);
                                        setCurrentJson(decode(decoderType, cslType, x));
                                    }
                                }}/>
                            </div>
                            <div className="right-col">
                                <div>
                                    <JsonViewer
                                        sx={{fontSize: 14}}
                                        value={currentJson}
                                        valueTypes={[
                                            getPositionDataType(setCborPosition),
                                            getTxIdDataType(networkType),
                                            getTxAddressDataType(networkType),
                                        ]}/>
                                </div>
                            </div>
                        </SplitPane>
                    </div>
                </Grid>
            </Grid>
        </ThemeProvider>
    );
}

export default App;