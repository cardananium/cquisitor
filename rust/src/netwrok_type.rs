#[cfg(not(all(target_arch = "wasm32", not(target_os = "emscripten"))))]
use noop_proc_macro::wasm_bindgen;

#[cfg(all(target_arch = "wasm32", not(target_os = "emscripten")))]
use wasm_bindgen::prelude::{JsValue, wasm_bindgen};

#[derive(Clone)]
#[wasm_bindgen]
pub enum NetworkType {
    Mainnet = 0,
    TestnetPreprod = 1,
    TestnetPreview = 2,
}