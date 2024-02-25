#[cfg(not(all(target_arch = "wasm32", not(target_os = "emscripten"))))]
pub(crate) use noop_proc_macro::wasm_bindgen;

#[cfg(all(target_arch = "wasm32", not(target_os = "emscripten")))]
pub(crate) use wasm_bindgen::prelude::{JsValue, wasm_bindgen};