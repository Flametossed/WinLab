# WinLab

A Windows Server 2025 lab simulator that runs in your browser. Open a tab and start administering a server in seconds, with labs that check your work as you go and plenty of room to explore.

No VM, no install, no account. It's plain HTML, CSS and JavaScript, with no build step and no dependencies.

## What's in it

- **The shell:** boot, sign-in, desktop, taskbar, Start, Win+X, Run, Quick Settings, notifications, window snapping, dark mode, and a VMConnect-style host bar with checkpoints.
- **Server Manager:** Add Roles and Features, AD DS promotion, DHCP post-install, File and Storage Services.
- **Admin tools:** Active Directory Users and Computers, DNS Manager, DHCP, Event Viewer, Services, Computer Management, Disk Management, Group Policy Management (with the editor and Drive Maps preferences), Windows Defender Firewall with Advanced Security, Task Manager, IIS Manager, Hyper-V Manager.
- **Terminal:** PowerShell 5.1 and CMD tabs with an object pipeline, a large set of cmdlets and native tools, and `sconfig`.
- **Desktop apps:** File Explorer, Notepad, Settings, Control Panel, Network Connections and a mock Edge that browses the lab network.

Every tool works on the same model of the server, so a user created in ADUC shows up in `Get-ADUser` and a firewall rule added with `netsh` appears in `wf.msc`.

## Labs

The Lab Guide lists the built-in labs and can import more from JSON. Starting a lab resets the server to the lab's starting point. Objectives tick off live as you work, and you can go back to an earlier step. Built-in labs cover initial configuration, AD DS, AD objects, DNS, DHCP, storage and shares, IIS, services and event logs, the firewall, a file server, Group Policy, Task Manager troubleshooting, Hyper-V and Group Policy Preferences.

## Running it

Open `index.html` in a browser (Chrome, Edge or Firefox). It works straight from the file system or from any static host, such as GitHub Pages.

- First run walks through setup: you choose an Administrator password that meets the complexity rules.
- `index.html?quick=1` skips boot and sign-in (the password is `P@ssw0rd!` if setup hasn't been done).
- State is saved in your browser's `localStorage`. "Reset the lab" on the sign-in screen starts over.

## Tests

`node tests/run-headless.mjs` runs every browser test suite in headless Firefox (Node and Firefox only, no packages). Add suite names to run just those, or `--shot <mode>` to stop at a screen and save a screenshot. Output goes to `.test-output/`.

## Project notes

[HANDOFF.md](HANDOFF.md) is the detailed developer guide: architecture, the model APIs, the lab format, what each tool covers, known limits and the roadmap.

## Disclaimer

WinLab is an independent, unofficial training simulator. It is not affiliated with, endorsed by or sponsored by Microsoft. Windows, Windows Server, Active Directory, Hyper-V and other names are trademarks of Microsoft Corporation and are used only to describe what the simulator imitates. WinLab contains no Microsoft code or images: the icons and backgrounds are original. It simulates behaviour for study, so check anything important against real Windows Server and Microsoft's documentation.
