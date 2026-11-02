/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next 16.3+ otherwise writes a managed block into AGENTS.md on every
  // `next dev` run; the repo keeps AGENTS.md hand-written.
  agentRules: false,
};

export default nextConfig;
