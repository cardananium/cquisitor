use reqwest::Error;
use crate::js_error::JsError;

pub(crate) fn to_js_error(e: Error, location: &'static str) -> JsError {
    JsError::new(&format!("{}, {:?}", location, e))
}