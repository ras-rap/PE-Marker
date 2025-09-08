import { useTheme } from "@/components/theme-provider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="flex items-center gap-2">
      <Label htmlFor="theme-toggle" className="text-sm">
        {theme === "dark" ? "🌙 Dark" : "☀️ Light"}
      </Label>
      <Switch
        id="theme-toggle"
        checked={theme === "light"}
        onCheckedChange={toggleTheme}
      />
    </div>
  );
}