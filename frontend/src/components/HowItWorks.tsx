import React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

const HowItWorks: React.FC = () => {
  return (
    <section id="how">
      <Card className="bg-white dark:bg-black/70 border border-gray-200 dark:border-white/10 backdrop-blur-md">
        <CardHeader>
          <CardTitle>How does it work?</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong>Crowd Voting:</strong> Anyone can vote on whether a
              channel is owned by private equity.
            </li>
            <li>
              <strong>Admin Verification:</strong> Trusted admins can verify
              ownership status for accuracy.
            </li>
            <li>
              <strong>Browser Extension:</strong> The extension highlights
              channels directly on YouTube.
            </li>
            <li>
              <strong>Website:</strong> You can also search and vote here.
            </li>
          </ul>
        </CardContent>
      </Card>
    </section>
  );
};

export default HowItWorks;