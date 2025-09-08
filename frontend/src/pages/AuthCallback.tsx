import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

const API_BASE = "http://pem.ras-rap.click/api";

export default function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");

    if (!code) {
      navigate("/");
      return;
    }

    // Exchange code for token
    fetch(`${API_BASE}/auth/callback?code=${code}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.token) {
          localStorage.setItem("jwt", data.token);
          localStorage.setItem("user", JSON.stringify(data.user));
        }
        navigate("/"); // go back to home
      })
      .catch(() => navigate("/"));
  }, [navigate]);

  return <p className="text-center mt-10">Signing you in...</p>;
}