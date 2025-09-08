import React, { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { ChannelData, VoteRequest, VerifyRequest } from "../types";

const API_BASE = "/api";

const SearchVote: React.FC = () => {
  const [input, setInput] = useState("");
  const [channel, setChannel] = useState<ChannelData | null>(null);
  const [message, setMessage] = useState("");
  const [user, setUser] = useState<{ isAdmin: boolean } | null>(null);

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

  function extractChannelId(urlOrId: string): string {
    if (urlOrId.includes("youtube.com")) {
      const match = urlOrId.match(/@[\w-]+/);
      if (match) return match[0];
    }
    return urlOrId.trim();
  }

  async function searchChannel() {
    setMessage("");
    setChannel(null);
    try {
      const id = extractChannelId(input);
      const res = await fetch(`${API_BASE}/channel/${id}`);
      if (!res.ok) throw new Error("Channel not found");
      const data: ChannelData = await res.json();
      setChannel(data);
    } catch {
      setMessage("Channel not found or error fetching data.");
    }
  }

  async function vote(vote: "yes" | "no") {
    if (!channel) return;
    try {
      const body: VoteRequest = { channelId: channel.id, vote };
      const res = await fetch(`${API_BASE}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Vote failed");
      setMessage("✅ Vote submitted!");
      await searchChannel(); // refresh data
    } catch {
      setMessage("❌ Error submitting vote.");
    }
  }

  async function verify(status: 0 | 1 | 2) {
    if (!channel) return;
    const token = localStorage.getItem("jwt");
    if (!token) return setMessage("Unauthorized");

    try {
      const body: VerifyRequest = { channelId: channel.id, status };
      const res = await fetch(`${API_BASE}/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Verify failed");
      setMessage("✅ Verification updated!");
      await searchChannel();
    } catch {
      setMessage("❌ Error verifying channel.");
    }
  }

  function renderVerification(status: number) {
    if (status === 1) return "✅ Verified: Owned by Private Equity";
    if (status === 2) return "✅ Verified: Not owned by Private Equity";
    return "⚠️ Not verified yet";
  }

  return (
    <section id="vote" className="space-y-4">
      <h2 className="text-2xl font-bold">Search & Vote</h2>
      <div className="flex gap-2">
        <Input
          placeholder="Channel ID or URL"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="bg-white dark:bg-black/60 text-black dark:text-white border-gray-300 dark:border-white/20"
        />
        <Button onClick={searchChannel} className="bg-blue-600 hover:bg-blue-500">
          Search
        </Button>
      </div>

      {message && (
        <Alert className="bg-white dark:bg-black/70 border border-gray-200 dark:border-white/20 text-black dark:text-white">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}

      {channel && (
        <Card className="bg-white dark:bg-black/70 border border-gray-200 dark:border-white/10 backdrop-blur-md">
          <CardHeader>
            <CardTitle>{channel.name}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p>ID: {channel.id}</p>
            <p>{renderVerification(channel.verificationStatus)}</p>
            <p>
              Votes: <span className="text-red-500">PE {channel.votesYes}</span> |{" "}
              <span className="text-green-500">Indie {channel.votesNo}</span>
            </p>
            <div className="flex gap-2">
              <Button
                variant="destructive"
                onClick={() => vote("yes")}
                className="bg-red-600 hover:bg-red-500"
              >
                Vote PE Owned
              </Button>
              <Button
                variant="default"
                onClick={() => vote("no")}
                className="bg-green-600 hover:bg-green-500"
              >
                Vote Independent
              </Button>
            </div>

            {user?.isAdmin && (
              <div className="mt-4 space-x-2">
                <Button
                  onClick={() => verify(1)}
                  className="bg-red-700 hover:bg-red-600"
                >
                  Mark as PE Owned
                </Button>
                <Button
                  onClick={() => verify(2)}
                  className="bg-green-700 hover:bg-green-600"
                >
                  Mark as Independent
                </Button>
                <Button
                  onClick={() => verify(0)}
                  className="bg-gray-600 hover:bg-gray-500"
                >
                  Clear Verification
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </section>
  );
};

export default SearchVote;