export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <img src="/umbrella.svg" alt="" />
          <span>Post Umbrella</span>
        </div>
        <div className="footer-right">
          &copy; {new Date().getFullYear()} Patrick Xu
        </div>
      </div>
    </footer>
  )
}
