import React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

const Download: React.FC = () => {
  return (
    <section id="download" className="space-y-6">
      <Card className="bg-white dark:bg-black/70 border border-gray-200 dark:border-white/10 backdrop-blur-md">
        <CardHeader>
          <CardTitle>Download</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Chrome: You can download the extension from Github Releases. <a href="https://github.com/ras-rap/PE-Marker/releases/download/Main/Chrome.zip" className="text-blue-600 hover:underline">Direct Link</a>
            </li>
            <li>
              Firefox: You can download the extension from the Firefox Add-ons site. <a href="https://addons.mozilla.org/en-US/firefox/addon/private-equity-marker/" className="text-blue-600 hover:underline">Direct Link</a>
            </li>
            <li>
              Other: Untested, but you can try to load the extension in other browsers that support Chrome extensions (e.g., Edge, Brave, Opera) or Firefox extensions (e.g., Waterfox).
            </li>
          </ul>
        </CardContent>
      </Card>
    </section>
  );
};

export default Download;