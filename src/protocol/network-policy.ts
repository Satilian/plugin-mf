export type NetworkOptions = {
  allowedProtocols?: ("http:" | "https:")[];
  allowedOrigins?: string[];
  requireServerIntegrity?: boolean;
};
