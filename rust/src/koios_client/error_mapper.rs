use reqwest::Error;
use crate::js_error::JsError;

pub(crate) fn to_js_error(e: Error) -> JsError {
    JsError::new(&format!("{}", e))
}