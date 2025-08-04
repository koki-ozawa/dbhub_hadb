/**
 * Type definition for supported database connector types
 */
export type ConnectorType = "HADB" | "postgres" | "mysql" | "mariadb" | "sqlite" | "sqlserver";

/**
 * Database Connector Interface
 * This defines the contract that all database connectors must implement.
 */
export interface SQLResult {
  rows: any[];
  [key: string]: any;
}

export interface TableColumn {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
}

export interface TableIndex {
  index_name: string;
  column_names: string[];
  is_unique: boolean;
  is_primary: boolean;
}

export interface StoredProcedure {
  procedure_name: string;
  procedure_type: "procedure" | "function";
  language: string;
  parameter_list: string;
  return_type?: string;
  definition?: string;
}

/**
 * Connection string (DSN) parser interface
 * Each connector needs to implement its own DSN parser
 */
export interface DSNParser {
  /**
   * Parse a connection string into connector-specific configuration
   * Example DSN formats:
   * - PostgreSQL: "postgres://user:password@localhost:5432/dbname?sslmode=disable"
   * - MariaDB: "mariadb://user:password@localhost:3306/dbname"
   * - MySQL: "mysql://user:password@localhost:3306/dbname"
   * - SQLite: "sqlite:///path/to/database.db" or "sqlite:///:memory:"
   */
  parse(dsn: string): Promise<any>;

  /**
   * Generate a sample DSN string for this connector type
   */
  getSampleDSN(): string;

  /**
   * Check if a DSN is valid for this connector
   */
  isValidDSN(dsn: string): boolean;
}

export interface Connector {
  /** A unique identifier for the connector */
  id: ConnectorType;

  /** Human-readable name of the connector */
  name: string;

  /** DSN parser for this connector */
  dsnParser: DSNParser;

  /** Connect to the database using DSN, with optional init script */
  connect(dsn: string, initScript?: string): Promise<void>;

  /** Close the connection */
  disconnect(): Promise<void>;

  /**
   * Get all schemas in the database
   * @returns Promise with array of schema names
   */
  getSchemas(): Promise<string[]>;

  /**
   * Get all tables in the database or in a specific schema
   * @param schema Optional schema name. If not provided, implementation should use the default schema:
   *   - PostgreSQL: 'public' schema
   *   - SQL Server: 'dbo' schema
   *   - MySQL: Current active database from connection (DATABASE())
   *   - SQLite: Main database (schema concept doesn't exist in SQLite)
   * @returns Promise with array of table names
   */
  getTables(schema?: string): Promise<string[]>;

  /**
   * Get schema information for a specific table
   * @param tableName The name of the table to get schema information for
   * @param schema Optional schema name. If not provided, implementation should use the default schema
   *   as described in getTables method.
   * @returns Promise with array of column information
   */
  getTableSchema(tableName: string, schema?: string): Promise<TableColumn[]>;

  /**
   * Check if a table exists
   * @param tableName The name of the table to check
   * @param schema Optional schema name. If not provided, implementation should use the default schema
   *   as described in getTables method.
   * @returns Promise with boolean indicating if table exists
   */
  tableExists(tableName: string, schema?: string): Promise<boolean>;

  /**
   * Get indexes for a specific table
   * @param tableName The name of the table to get indexes for
   * @param schema Optional schema name. If not provided, implementation should use the default schema
   *   as described in getTables method.
   * @returns Promise with array of index information
   */
  getTableIndexes(tableName: string, schema?: string): Promise<TableIndex[]>;

  /**
   * Get stored procedures/functions in the database or in a specific schema
   * @param schema Optional schema name. If not provided, implementation should use the default schema
   * @returns Promise with array of stored procedure/function names
   */
  getStoredProcedures(schema?: string): Promise<string[]>;

  /**
   * Get details for a specific stored procedure/function
   * @param procedureName The name of the procedure/function to get details for
   * @param schema Optional schema name. If not provided, implementation should use the default schema
   * @returns Promise with stored procedure details
   */
  getStoredProcedureDetail(procedureName: string, schema?: string): Promise<StoredProcedure>;

  /** Execute a SQL query */
  executeSQL(sql: string): Promise<SQLResult>;
}

/**
 * Registry for available database connectors
 */
export class ConnectorRegistry {
  private static connectors: Map<ConnectorType, Connector> = new Map();

  /**
   * Register a new connector
   */
  static register(connector: Connector): void {
    ConnectorRegistry.connectors.set(connector.id, connector);
  }

  /**
   * Get a connector by ID
   */
  static getConnector(id: ConnectorType): Connector | null {
    return ConnectorRegistry.connectors.get(id) || null;
  }

  /**
   * Get connector for a DSN string
   * Tries to find a connector that can handle the given DSN format
   */
  static getConnectorForDSN(dsn: string): Connector | null {
    for (const connector of ConnectorRegistry.connectors.values()) {
      if (connector.dsnParser.isValidDSN(dsn)) {
        return connector;
      }
    }
    return null;
  }

  /**
   * Get all available connector IDs
   */
  static getAvailableConnectors(): ConnectorType[] {
    return Array.from(ConnectorRegistry.connectors.keys());
  }

  /**
   * Get sample DSN for a specific connector
   */
  static getSampleDSN(connectorType: ConnectorType): string | null {
    const connector = ConnectorRegistry.getConnector(connectorType);
    if (!connector) return null;
    return connector.dsnParser.getSampleDSN();
  }

  /**
   * Get all available sample DSNs
   */
  static getAllSampleDSNs(): { [key in ConnectorType]?: string } {
    const samples: { [key in ConnectorType]?: string } = {};
    for (const [id, connector] of ConnectorRegistry.connectors.entries()) {
      samples[id] = connector.dsnParser.getSampleDSN();
    }
    return samples;
  }
}
