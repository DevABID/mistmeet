export default function Footer() {
  return (
    <footer className="site-footer">
      <span>© {new Date().getFullYear()} MIST Meet</span>
      <span>
        Developed by{" "}
        <a href="https://www.linkedin.com/in/abidurrahmanabid/" target="_blank" rel="noopener noreferrer">
          Abidur Rahman
        </a>
      </span>
    </footer>
  );
}
