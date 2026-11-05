# AutoClick Pilot Privacy Policy

Effective date: November 4, 2026

AutoClick Pilot automatically clicks elements you select on websites for which you create rules and grant access.

## Data used by the extension

The extension stores the rules you create, including site addresses and optional paths, element selectors, nicknames, enabled state, timing settings, and rule identifiers and timestamps. Rules are stored in `chrome.storage.sync`. Chrome may synchronize this data through Google's Chrome Sync service according to your browser settings and Google's policies. Site permissions are managed separately by Chrome and must be granted in each browser profile.

When you open the popup, the extension reads the active tab's URL to suggest a site for a new rule. On permitted pages, it uses the page URL to find matching rules and inspects page elements to locate and click a visible match. It displays a per-tab click count on its toolbar badge. It does not record a browsing history or send page contents or click activity to the developer.

## Sharing and remote services

AutoClick Pilot has no developer-operated server, analytics, advertising, or tracking service. The developer does not receive, sell, or use your rules or page data for advertising, creditworthiness, lending, or purposes unrelated to the extension's functionality. Rule synchronization is handled by Chrome Sync, rather than a service operated by the developer.

Automated clicks interact with websites you choose. Those websites may process the interaction under their own privacy policies, just as they process other interactions with their pages.

## Your controls

You can edit, disable, or delete rules in the popup or settings page and manage site permissions in Chrome. Deleting a rule removes its entry from Chrome Sync storage; synchronization and retention by Google are governed by Chrome Sync and Google's policies. Disabling a rule retains its saved settings.

If you export rules, the extension saves a JSON file containing those rules to a location managed by your browser. You control whether to keep, share, or delete exported copies. Importing a file stores its valid rules in Chrome Sync storage.

## Changes and contact

This policy will be updated when the extension's data practices change. For questions, open an issue at [the AutoClick Pilot repository](https://github.com/pavankjadda/autoclick-pilot/issues). GitHub issues are public, so do not include private rules, credentials, or other sensitive information.
