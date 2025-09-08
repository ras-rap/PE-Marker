import React, { useEffect, useState } from "react";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuList,
  NavigationMenuLink,
} from "@/components/ui/navigation-menu";
import { ThemeToggle } from "./ThemeToggle";

const API_BASE = "/api";

const Header: React.FC = () => {
  const [user, setUser] = useState<{ username: string; isAdmin: boolean } | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("jwt");
    if (token) {
      fetch(`${API_BASE}/me`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((res) => res.json())
        .then((data) => {
          if (!data.error) setUser(data);
        });
    }
  }, []);

  function login() {
  window.location.href = `https://discord.com/api/oauth2/authorize?client_id=${
    import.meta.env.VITE_DISCORD_CLIENT_ID
  }&redirect_uri=${encodeURIComponent(
    import.meta.env.VITE_DISCORD_REDIRECT_URI
  )}&response_type=code&scope=identify`;
}

  function logout() {
    localStorage.removeItem("jwt");
    setUser(null);
  }

  return (
    <header className="bg-black/80 backdrop-blur-md text-white py-4 shadow border-b border-white/10">
      <div className="container mx-auto px-4 flex justify-between items-center">
        <h1 className="text-xl font-bold">Private Equity Marker</h1>
        <div className="flex items-center gap-6">
          <NavigationMenu>
            <NavigationMenuList>
              <NavigationMenuItem>
                <NavigationMenuLink href="#about">About</NavigationMenuLink>
              </NavigationMenuItem>
              <NavigationMenuItem>
                <NavigationMenuLink href="#how">How It Works</NavigationMenuLink>
              </NavigationMenuItem>
              <NavigationMenuItem>
                <NavigationMenuLink href="#vote">Search & Vote</NavigationMenuLink>
              </NavigationMenuItem>
            </NavigationMenuList>
          </NavigationMenu>
          <ThemeToggle />
          {user ? (
            <div className="flex items-center gap-2">
              <span>{user.username}</span>
              <button onClick={logout} className="text-sm underline">
                Logout
              </button>
            </div>
          ) : (
            <button onClick={login} className="text-sm underline">
              Login with Discord
            </button>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header;