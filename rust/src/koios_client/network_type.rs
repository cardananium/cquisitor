
pub(crate) enum NetworkType {
    Mainnet,
    TestnetPreprod,
    TestnetPreview,
}

impl NetworkType {
    pub(crate) fn get_url(&self) -> &str {
        match self {
            NetworkType::Mainnet => "https://api.koios.rest/api/v1/",
            NetworkType::TestnetPreprod => "https://preprod.koios.rest/api/v1/",
            NetworkType::TestnetPreview => "https://preview.koios.rest/api/v1/",
        }
    }

    pub(crate) fn build_url(&self, endpoint: &str) -> String {
        format!("{}{}", self.get_url(), endpoint)
    }
}

impl From<crate::netwrok_type::NetworkType> for NetworkType {
    fn from(network_type: crate::netwrok_type::NetworkType) -> Self {
        match network_type {
            crate::netwrok_type::NetworkType::Mainnet => NetworkType::Mainnet,
            crate::netwrok_type::NetworkType::TestnetPreprod => NetworkType::TestnetPreprod,
            crate::netwrok_type::NetworkType::TestnetPreview => NetworkType::TestnetPreview,
        }
    }
}