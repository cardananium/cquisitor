#[cfg(all(target_arch = "wasm32", not(target_os = "emscripten")))]
pub type JsError = wasm_bindgen::prelude::JsError;

#[cfg(not(all(target_arch = "wasm32", not(target_os = "emscripten"))))]
#[derive(Debug, Clone)]
pub struct JsError {
    msg: String,
}

#[cfg(not(all(target_arch = "wasm32", not(target_os = "emscripten"))))]
impl JsError {

    pub fn new(s: &str) -> Self {
        Self { msg: s.to_owned() }
    }

    pub fn from_str(s: &str) -> Self {
        Self { msg: s.to_owned() }
    }

    // to match JsValue's API even though to_string() exists
    pub fn as_string(&self) -> Option<String> {
        Some(self.msg.clone())
    }
}

#[cfg(not(all(target_arch = "wasm32", not(target_os = "emscripten"))))]
impl std::fmt::Display for JsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.msg)
    }
}

#[cfg(not(all(target_arch = "wasm32", not(target_os = "emscripten"))))]
impl std::error::Error for JsError {}