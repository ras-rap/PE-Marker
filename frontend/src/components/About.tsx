import React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

const About: React.FC = () => {
  return (
    <section id="about">
      <Card className="bg-white dark:bg-black/70 border border-gray-200 dark:border-white/10 backdrop-blur-md">
        <CardHeader>
          <CardTitle>What is this project?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p>
            This project helps identify YouTube channels that are owned by
            private equity firms. Channels owned by private equity often prioritize profit over quality content, which can lead to a decline in the diversity and integrity of the platform.
          </p>
          <p>
            Our goal is to make ownership more transparent so viewers can make
            informed choices about the content they consume.
          </p>
        </CardContent>
      </Card>
    </section>
  );
};

export default About;