const DISCLAIMER_URL = "https://github.com/cardananium/cquisitor/blob/main/DISCLAIMER.md";

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <p className="site-footer-text">
        Provided as is, without warranty of any kind. The authors accept no responsibility or
        liability for any use of this tool or its output, by any person or entity, for any
        purpose.{" "}
        <a
          href={DISCLAIMER_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="site-footer-link"
        >
          Disclaimer
        </a>
      </p>
    </footer>
  );
}
