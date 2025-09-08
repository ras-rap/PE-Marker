/* eslint-disable no-console */
/**
 * Build and package a WebExtension for Chrome (MV3) and Firefox (MV2) using JSZip.
 * Run from this directory (extension/) with:
 *   bun add jszip
 *   bun run build.ts
 */

import JSZip from 'jszip';

// Clear IDE errors
const Bun = globalThis.Bun;

type ManifestV3 = {
  manifest_version: 3;
  name: string;
  version: string;
  description?: string;
  permissions?: string[];
  background?: { service_worker: string };
  web_accessible_resources?: Array<{
    resources: string[];
    matches: string[];
  }>;
  content_scripts?: Array<{ matches: string[]; js: string[] }>;
  action?: {
    default_popup?: string;
    default_icon?: Record<string, string>;
  };
};

type ManifestV2 = {
  manifest_version: 2;
  name: string;
  version: string;
  description?: string;
  permissions?: string[];
  background?: { scripts: string[]; persistent?: boolean };
  web_accessible_resources?: string[];
  content_scripts?: Array<{ matches: string[]; js: string[] }>;
  browser_action?: {
    default_popup?: string;
    default_icon?: Record<string, string>;
  };
  browser_specific_settings?: {
    gecko?: { id?: string; strict_min_version?: string };
  };
};

const SRC_DIR = "src";
const DIST_DIR = "dist";
const CHROME_DIR = `${DIST_DIR}/chrome`;
const FIREFOX_DIR = `${DIST_DIR}/firefox`;
const CHROME_ZIP = `${CHROME_DIR}/extension.zip`;
const FIREFOX_XPI = `${FIREFOX_DIR}/extension.xpi`;

// Chrome MV3 manifest
const CHROME_MANIFEST: ManifestV3 = {
  manifest_version: 3,
  name: "Private Equity Marker",
  version: "1.1",
  description: "Flags YouTube channels owned by private equity firms.",
  permissions: ["storage", "activeTab", "scripting"],
  background: {
    service_worker: "background.js",
  },
  web_accessible_resources: [
    {
      resources: ["icons/shill.svg", "icons/indie.svg"],
      matches: ["<all_urls>"],
    },
  ],
  content_scripts: [
    {
      matches: ["*://www.youtube.com/*"],
      js: ["content.js"],
    },
  ],
  action: {
    default_popup: "popup.html",
    default_icon: {
      "16": "icons/icon128.png",
      "48": "icons/icon128.png",
      "128": "icons/icon128.png",
    },
  },
};

// Firefox MV2 manifest
const FIREFOX_MANIFEST: ManifestV2 = {
  manifest_version: 2,
  name: "Private Equity Marker",
  version: "1.1",
  description: "Flags YouTube channels owned by private equity firms.",
  permissions: ["storage", "activeTab", "tabs"],
  background: {
    scripts: ["background.js"],
    persistent: false,
  },
  web_accessible_resources: ["icons/shill.svg", "icons/indie.svg"],
  content_scripts: [
    {
      matches: ["*://www.youtube.com/*"],
      js: ["content.js"],
    },
  ],
  browser_action: {
    default_popup: "popup.html",
    default_icon: {
      "16": "icons/icon128.png",
      "48": "icons/icon128.png",
      "128": "icons/icon128.png",
    },
  },
  browser_specific_settings: {
    gecko: {
      id: "ben@krakenhosting.net",
      strict_min_version: "91.0",
    },
  },
};

// Ensure directory exists
async function ensureDir(path: string): Promise<void> {
  await Bun.$`mkdir -p ${path}`.quiet().nothrow();
}

// Clean directory
async function cleanDir(path: string): Promise<void> {
  await Bun.$`rm -rf ${path}`.quiet().nothrow();
}

// Copy file using Bun APIs
async function copyFile(srcPath: string, destPath: string): Promise<boolean> {
  try {
    const srcFile = Bun.file(srcPath);
    if (await srcFile.exists()) {
      const content = await srcFile.arrayBuffer();
      await Bun.write(destPath, content);
      return true;
    }
  } catch (error) {
    console.warn(`Failed to copy ${srcPath}:`, error);
  }
  return false;
}

// Get all files from source directory
async function getSourceFiles(): Promise<string[]> {
  const knownFiles = [
    // Root files
    `${SRC_DIR}/background.js`,
    `${SRC_DIR}/content.js`,
    `${SRC_DIR}/iconModule.js`,
    `${SRC_DIR}/popup.html`,
    `${SRC_DIR}/popup.js`,
    `${SRC_DIR}/settings.html`,
    `${SRC_DIR}/settings.js`,
    `${SRC_DIR}/styles.css`,
    
    // Icons
    `${SRC_DIR}/icons/shill.svg`,
    `${SRC_DIR}/icons/indie.svg`,
    `${SRC_DIR}/icons/icon128.png`,
  ];

  const existingFiles: string[] = [];
  for (const filePath of knownFiles) {
    const file = Bun.file(filePath);
    if (await file.exists()) {
      existingFiles.push(filePath);
    }
  }

  console.log(`Found ${existingFiles.length} source files`);
  return existingFiles;
}

// Copy directory contents to target
async function copyToTarget(srcFiles: string[], targetDir: string): Promise<void> {
  await ensureDir(targetDir);
  
  for (const srcFile of srcFiles) {
    const relPath = srcFile.substring(SRC_DIR.length + 1);
    const destPath = `${targetDir}/${relPath}`;
    
    // Skip source manifests
    if (relPath.toLowerCase().includes('manifest.json')) {
      continue;
    }
    
    // Ensure destination directory exists
    const destDir = destPath.substring(0, destPath.lastIndexOf('/') + 1);
    await ensureDir(destDir);
    
    const copied = await copyFile(srcFile, destPath);
    if (copied) {
      console.log(`Copied: ${relPath}`);
    }
  }
}

// Write manifest as JSON
async function writeManifest(targetDir: string, manifest: unknown): Promise<void> {
  const content = JSON.stringify(manifest, null, 2) + "\n";
  const manifestPath = `${targetDir}/manifest.json`;
  await Bun.write(manifestPath, content);
  console.log(`Wrote manifest: ${manifestPath}`);
}

// Create ZIP using JSZip
async function createZipWithJSZip(targetDir: string, outputFile: string, manifest: unknown): Promise<void> {
  console.log(`Creating ZIP for ${targetDir}...`);
  
  const zip = new JSZip();
  const sourceFiles = await getSourceFiles();
  
  // Add all source files to ZIP
  for (const srcFile of sourceFiles) {
    const relPath = srcFile.substring(SRC_DIR.length + 1);
    
    // Skip source manifests
    if (relPath.toLowerCase().includes('manifest.json')) {
      continue;
    }
    
    const file = Bun.file(srcFile);
    const content = await file.arrayBuffer();
    zip.file(relPath, content);
    console.log(`Added to ZIP: ${relPath}`);
  }
  
  // Add the target-specific manifest
  zip.file('manifest.json', JSON.stringify(manifest, null, 2) + "\n");
  console.log("Added manifest to ZIP");
  
  // Generate and write ZIP
  const zipContent = await zip.generateAsync({ type: 'uint8array' });
  await Bun.write(outputFile, zipContent);
  
  console.log(`Created ${outputFile} (${zipContent.length} bytes)`);
}

// Check if source directory exists
async function sourceDirExists(): Promise<boolean> {
  try {
    const marker = Bun.file(`${SRC_DIR}/background.js`); // Use a known file
    return await marker.exists();
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  console.log("Building Private Equity Marker for Chrome and Firefox using JSZip...");
  
  // Check source directory
  if (!(await sourceDirExists())) {
    throw new Error(`Source directory "${SRC_DIR}" not found. Make sure you have the extension files in src/`);
  }
  
  console.log(`✓ Found source directory: ${SRC_DIR}`);

  // Clean and prepare directories
  console.log("Preparing output directories...");
  await cleanDir(DIST_DIR);
  await ensureDir(CHROME_DIR);
  await ensureDir(FIREFOX_DIR);

  // Copy files to targets and write manifests
  console.log("Preparing Chrome target...");
  const sourceFiles = await getSourceFiles();
  await copyToTarget(sourceFiles, CHROME_DIR);
  await writeManifest(CHROME_DIR, CHROME_MANIFEST);
  
  console.log("Preparing Firefox target...");
  await copyToTarget(sourceFiles, FIREFOX_DIR);
  await writeManifest(FIREFOX_DIR, FIREFOX_MANIFEST);

  // Create packages
  console.log("\n--- Packaging ---");
  await createZipWithJSZip(CHROME_DIR, CHROME_ZIP, CHROME_MANIFEST);
  await createZipWithJSZip(FIREFOX_DIR, FIREFOX_XPI, FIREFOX_MANIFEST);

  console.log("\n✅ Build complete!");

  console.log("\nOutput files:");
  console.log(`• Chrome: ${CHROME_ZIP}`);
  console.log(`• Firefox: ${FIREFOX_XPI}`);
  
  console.log("\nDevelopment:");
  console.log("• Chrome: Load unpacked from dist/chrome/");
  console.log("• Firefox: Load unpacked from dist/firefox/");
  
  console.log("\nStore submission:");
  console.log("• Chrome Web Store: Upload extension.zip");
  console.log("• Firefox Add-ons: Submit extension.xpi");
  
  // Verify the ZIP files can be read
  console.log("\nVerifying packages...");
  const chromeZipFile = Bun.file(CHROME_ZIP);
  const firefoxXpiFile = Bun.file(FIREFOX_XPI);
  
  if (await chromeZipFile.exists()) {
    console.log(`✓ Chrome ZIP: ${(await chromeZipFile.size)} bytes`);
  } else {
    console.log("✗ Chrome ZIP not created");
  }
  
  if (await firefoxXpiFile.exists()) {
    console.log(`✓ Firefox XPI: ${(await firefoxXpiFile.size)} bytes`);
  } else {
    console.log("✗ Firefox XPI not created");
  }
}

main().catch((err) => {
  console.error("Build failed:", err);
});