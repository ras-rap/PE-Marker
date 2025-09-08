import React from "react";

const Footer: React.FC = () => {
  return (
    <footer className="bg-gray-200 dark:bg-black/80 py-4 mt-8 border-t border-gray-300 dark:border-white/10">
      <div className="container mx-auto px-4 text-center text-sm text-gray-700 dark:text-gray-300">
        © {new Date().getFullYear()} Private Equity Marker. Built with ❤️ by <a
          href="https://ras-rap.click"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-500 hover:underline"
        >
          Ras_rap
        </a>.
      </div>
    </footer>
  );
};

export default Footer;