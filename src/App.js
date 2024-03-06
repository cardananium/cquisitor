import './App.css';
import SplitPane from 'react-split-pane';
import {CborInput} from "./CborInput";
import {CslList} from "./CslList";
import {useCallback, useEffect, useState} from "react";
import {JsonViewer} from "@textea/json-viewer";
import {
    AppBar, Box,
    Container,
    Grid,
    MenuItem,
    Select,
    Toolbar,
    Typography
} from "@mui/material";
import {ThemeProvider, createTheme} from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import {cbor_to_json, decode_plutus_program_uplc_json, decode_plutus_program_pretty_uplc} from 'cquisitor_wasm'
import {cslDecode} from './tools/cls-helpers';
import {getPositionDataType, getTxAddressDataType, getTxIdDataType} from './tools/dataTypes-helper';
import {checkBlockOrTx} from "./tools/signature-helper";
import GitHubButton from 'react-github-btn'
import {PlutusExecutorMenu} from "./PlutusExecutorMenu";

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
    message2: "This is tool to decode CBOR into JSON representation. Just put your CBOR hex on the right side",
    message3: "You can also decode CBOR by cardano-serialization-lib. Choose that option on the top list to use it",
    message4: "To check signatures of transactions, choose that option on the top list and paste block hex or tx hex"
};

function isASCII(str) {
    // eslint-disable-next-line no-control-regex
    return /^[\x00-\x7F]*$/.test(str);
}

function App() {
    const [cborHex, setCborHex] = useState("");
    const [cborPosition, setCborPosition] = useState([0, 0]);
    const [decoderType, setDecoderType] = useState(0);
    const [cslType, setCslType] = useState(null);
    const [networkType, setNetworkType] = useState(null);
    const [currentData, setCurrentData] = useState(object_stub);
    const [cslSchemaType, setCslSchemaType] = useState(null);

    const plutusExecutorResultHandler = useCallback((result) => {
        setCurrentData(result);
    }, []);

    useEffect(() => {
        decode();
    }, [decoderType, cborHex, cslType, cslSchemaType]);

    const decode = () => {
        try {

            if((cborHex == null || cborHex === "") && decoderType === 0) {
                setCurrentData(object_stub);
                return;
            }

            if (!cborHex.match("^[0-9A-Fa-f]+$") && !isASCII(cborHex)) {
                setCurrentData({decode_error: "String must be hex or bech32"});
            }

            if (decoderType === 0) {
                setCurrentData(JSON.parse(cbor_to_json(cborHex)));
            }

            if (decoderType === 1) {
                if (cslType == null) {
                    setCurrentData( {decode_error: "You need to choose a CSL type"});
                } else {
                    const cslJson = cslDecode(cborHex, cslType, cslSchemaType);
                    if (typeof cslJson === 'string' || cslJson instanceof String) {
                        setCurrentData(JSON.parse(cslJson));
                    } else {
                        setCurrentData(cslJson);
                    }
                }
            }

            if (decoderType === 2) {
                setCurrentData(checkBlockOrTx(cborHex));
            }

            if (decoderType === 3) {
                setCurrentData(JSON.parse(decode_plutus_program_uplc_json(cborHex)));
            }

            if (decoderType === 4) {
                setCurrentData(decode_plutus_program_pretty_uplc(cborHex));
            }

        } catch (e) {
            setCurrentData({decode_error: e.toString()});
        }
    };

    let showAsJson = true;
    if (typeof currentData === 'string' || currentData instanceof String){
        console.log(currentData)
        showAsJson = false
    }

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
                                            if(e.target.value === 5) {
                                                setCurrentData(
                                                    {
                                                        "WARNING": "To use this feature, you need to have a valid Koios API key. Please provide it in the input field.",
                                                        "KIOS URL" : "https://koios.rest/pricing/Pricing.html"
                                                    }
                                                )
                                            }
                                        }}
                                    >
                                        <MenuItem sx={{fontSize: 14}} value={0}>CBOR to JSON</MenuItem>
                                        <MenuItem sx={{fontSize: 14}} value={1}>Decode by CSL</MenuItem>
                                        <MenuItem sx={{fontSize: 14}} value={2}>Check tx signatures</MenuItem>
                                        <MenuItem sx={{fontSize: 14}} value={3}>Decode plutus CBOR (json structure) </MenuItem>
                                        <MenuItem sx={{fontSize: 14}} value={4}>Decode plutus CBOR (plain uplc) </MenuItem>
                                        <MenuItem sx={{fontSize: 14}} value={5}>Run plutus scripts from tx </MenuItem>
                                    </Select>
                                    <CslList show={decoderType === 1} onChoose={(newCslType, newNetworkType, schemaType) => {
                                        //split this into separate if's
                                        if (newCslType !== cslType) {
                                            setCslType(newCslType);
                                            setCborPosition([0, 0]);
                                        }
                                        if(newNetworkType !== networkType) {
                                            setNetworkType(newNetworkType);
                                            setCborPosition([0, 0]);
                                        }
                                        if(schemaType !== cslSchemaType) {
                                            setCslSchemaType(schemaType);
                                            setCborPosition([0, 0]);
                                        }
                                    }}/>
                                    <PlutusExecutorMenu show={decoderType === 5} cborHex={cborHex} onResult={plutusExecutorResultHandler}/>
                                    <Box sx={{ flexGrow: 1 }} />
                                    <GitHubButton href="https://github.com/cardananium/cquisitor" data-size="large" data-show-count="true" aria-label="Star cardananium/cquisitor on GitHub">Star</GitHubButton>
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
                                    }
                                }}/>
                            </div>
                            <div className="right-col">
                                <div>
                                    {showAsJson ? (
                                        <JsonViewer
                                            sx={{fontSize: 14}}
                                            value={currentData}
                                            valueTypes={[
                                                getPositionDataType(setCborPosition),
                                                getTxIdDataType(networkType),
                                                getTxAddressDataType(networkType),
                                            ]}/> ) : (
                                        <Typography  variant="body2" >{currentData}</Typography>
                                )}
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
