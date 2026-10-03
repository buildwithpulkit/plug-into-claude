# Privacy policy

Last updated: October 3, 2026

tangents is a plugin for Claude Code. This policy describes what data it
handles and where that data goes. In short: it runs entirely inside your
Claude Code session, it collects nothing, and its author receives nothing.

## What the plugin reads

- **Your conversation in the current Claude Code session.** When you ask a
  question in a tangent, the plugin reads the conversation up to and including
  the reply your tangent is about, to give Claude context.
- **The paragraph you picked and what you type in the tangent.**

## Where data is sent

When you ask a question in a tangent, the plugin sends the conversation, the
paragraph, the tangent so far and your question to Claude for an answer. When
you promote a tangent, it also sends the tangent to Claude (the Haiku model)
for a short summary.

Both requests go through your own Claude Code session's existing connection
to its model provider (Anthropic, or the provider your organization has
configured), the same way Claude Code sends your messages. That provider's
own terms and privacy policy apply to those requests.

The plugin sends nothing anywhere else. It has no server, makes no network
requests of its own, and includes no analytics or tracking.

## What the plugin stores

- **Tangents** (the paragraph, your questions and Claude's answers) are kept in
  Claude Code's state for the current session. They are not shared with other
  sessions and are gone when the session ends.
- **Promoted summaries.** When you choose **Promote to main**, the plugin adds
  one short summary to your conversation. From then on it is part of your
  conversation and is kept the same way Claude Code keeps the rest of it.
  Nothing is promoted unless you choose to.

The plugin writes no files, reads no files, runs no programs, and never
touches your credentials.

## Personal data

The plugin does not collect personal data such as names, email addresses or
postal addresses. If you type personal information into your conversation or a
tangent, it is handled as described above, like any other text.

## Changes

If the plugin starts handling data differently, this policy will be updated in
the same change, and the date above will change with it.

## Contact

Questions about this policy: open an issue at
https://github.com/buildwithpulkit/plug-into-claude/issues
