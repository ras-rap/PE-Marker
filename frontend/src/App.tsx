import { Routes, Route } from "react-router-dom";
import Header from "./components/Header";
import About from "./components/About";
import HowItWorks from "./components/HowItWorks";
import SearchVote from "./components/SearchVote";
import Footer from "./components/Footer";
import AuthCallback from "./pages/AuthCallback";

function App() {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-black text-gray-900 dark:text-gray-100">
      <Header />
      <main className="flex-1 container mx-auto px-4 py-8 space-y-12">
        <Routes>
          <Route
            path="/"
            element={
              <>
                <About />
                <HowItWorks />
                <SearchVote />
              </>
            }
          />
          <Route path="/auth/callback" element={<AuthCallback />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}

export default App;