# Private Equity Marker Extension

The extension works on both Chrome and Firefox, other browsers untested

## What is it?

This is a web extension that uses community votes and admin verification to mark Youtube channels owned by a private equity firm.

## What data is collected and where is it sent

No data is collected other than the channel ids, their display name, and your vote on it if you vote. Any data is sent to https://pem.ras-rap.click 

## Installation

You can get the Firefox extension from AMO (Once published) and the Chrome extension can be downloaded from github releases (Or somewhere else, still undecided)

## Building the script

First, cd into the main extension folder

``` cd extension ```

Then run

``` bun install ```

Next

``` bun build.ts ```

And now you have the packaged Chrome and Firefox extensions.

### Technical stuff for AMO

Tested on a Windows 10 device with 16 gb ram and a i3-1115G4. Untested with Node, only Bun, most likely wont work with Node as the build script uses Bun APIS. The build script pretty much only packs the right manifest file into it, then puts it in the right format.