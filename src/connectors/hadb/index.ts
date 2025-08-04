import odbc from "odbc";
import {
  Connector,
  ConnectorType,
  ConnectorRegistry,
  DSNParser,
  SQLResult,
  TableColumn,
  TableIndex,
  StoredProcedure,
} from "../interface.js";
import { SafeURL } from "../../utils/safe-url.js";
import { obfuscateDSNPassword } from "../../utils/dsn-obfuscate.js";

/**
 * HADB DSN Parser
 * DSN例: hadb://user:password@host:port/dbname?driver=HADBDriver
 */
class HADBDSNParser implements DSNParser {
  async parse(dsn: string): Promise<string> {
    if (!this.isValidDSN(dsn)) {
      const obfuscatedDSN = obfuscateDSNPassword(dsn);
      const expectedFormat = this.getSampleDSN();
      throw new Error(
        `Invalid HADB DSN format.\nProvided: ${obfuscatedDSN}\nExpected: ${expectedFormat}`
      );
    }
    try {
      // Use the SafeURL helper instead of the built-in URL
      // This will handle special characters in passwords, etc.
      const url = new SafeURL(dsn);
      // ODBC接続文字列を生成
      let connStr = `DRIVER=${url.searchParams.get("driver") || "HADBDriver"};`;
      connStr += `SERVER=${url.hostname};`;
      if (url.port) connStr += `PORT=${url.port};`;
      if (url.pathname) connStr += `DATABASE=${url.pathname.substring(1)};`;
      if (url.username) connStr += `UID=${url.username};`;
      if (url.password) connStr += `PWD=${url.password};`;
      // 他のパラメータも追加
      // SSLやその他のオプションがあれば追加
      url.forEachSearchParam((value, key) => {
        if (!["driver"].includes(key)) {
          connStr += `${key.toUpperCase()}=${value};`;
          }
      });
      return connStr;
    } catch (error) {
      throw new Error(
        `Failed to parse HADB DSN: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  getSampleDSN(): string {
    return "hadb://user:password@localhost:30015/DBNAME?driver=HADBDriver";
  }

  isValidDSN(dsn: string): boolean {
    try {
      return dsn.startsWith("hadb://");
    } catch {
      return false;
    }
  }
}

/**
 * HADB Connector Implementation
 */
export class HADBConnector implements Connector {
  id: ConnectorType = "HADB";
  name = "HADB";
  dsnParser = new HADBDSNParser();

  private connection: odbc.Connection | null = null;

  async connect(dsn: string): Promise<void> {
    try {
      const connStr = await this.dsnParser.parse(dsn);
      this.connection = await odbc.connect(connStr);
      // 接続テスト
      await this.connection.query("SELECT * FROM master.tables limit 1");
      console.error("Successfully connected to HADB database");
    } catch (err) {
      console.error("Failed to connect to HADB database:", err);
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    if (this.connection) {
      await this.connection.close();
      this.connection = null;
    }
  }

  // Returns the connection object for direct queries
  // TODO: HADB用に修正が必要
  async getSchemas(): Promise<string[]> {
    if (!this.connection) throw new Error("Not connected to database");
    const result = await this.connection.query(
      `SELECT SCHEMA_NAME 
      FROM INFORMATION_SCHEMA.SCHEMATA 
      ORDER BY SCHEMA_NAME`
    );
    return result.map((row: any) => row.SCHEMA_NAME);
  }

  async getTables(schema?: string): Promise<string[]> {
    if (!this.connection )throw new Error("Not connected to database");
    //postgresではスキーマが指定されていない場合はPUBLICを使用していた
    const schemaToUse = schema || "PUBLIC";
    const result = await this.connection.query(
      `SELECT TABLE_NAME 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_SCHEMA = ? 
      ORDER BY TABLE_NAME`,
        [schemaToUse]
      );
    return result.map((row: any) => row.TABLE_NAME);
  }

  // Check if a table exists in the specified schema
  async tableExists(tableName: string, schema?: string): Promise<boolean> {
    if (!this.connection) throw new Error("Not connected to database");
    const schemaToUse = schema || "PUBLIC";
    // ?の部分はODBCのパラメータバインディングを使用
    const result = await this.connection.query(
      `SELECT COUNT(*) AS CNT 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
        [schemaToUse, tableName]
      );
    const rows = result as any[];
    // resultはodbc.Result型で、resultの中に「array」プロパティがある
    return rows[0]?.CNT > 0;
  }

  async getTableIndexes(tableName: string, schema?: string): Promise<TableIndex[]> {
    if (!this.connection) throw new Error("Not connected to database");
    const schemaToUse = schema || "PUBLIC";
    const result = await this.connection.query(
      `SELECT INDEX_NAME, COLUMN_NAME, IS_UNIQUE
       FROM INFORMATION_SCHEMA.INDEXES
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY INDEX_NAME, ORDINAL_POSITION`,
      [schemaToUse, tableName]
    );
    // INDEX_NAMEごとにまとめる
    const indexMap: Record<string, TableIndex> = {};
    for (const row of result as any[]) {
      if (!indexMap[row.INDEX_NAME]) {
        indexMap[row.INDEX_NAME] = {
          index_name: row.INDEX_NAME,
          column_names: [],
          is_unique: row.IS_UNIQUE === "YES",
          is_primary: false, // 必要なら追加取得
        };
      }
      indexMap[row.INDEX_NAME].column_names.push(row.COLUMN_NAME);
    }
    return Object.values(indexMap);
  }

  async getTableSchema(tableName: string, schema?: string): Promise<TableColumn[]> {
    if (!this.connection) throw new Error("Not connected to database");
    const schemaToUse = schema || "PUBLIC";
    const result = await this.connection.query(
      `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
        [schemaToUse, tableName]
      );
    return result.map((row: any) => ({
      column_name: row.COLUMN_NAME,
      data_type: row.DATA_TYPE,
      is_nullable: row.IS_NULLABLE,
      column_default: row.COLUMN_DEFAULT,
    }));
  }

  // Get stored procedures/functions in the database or in a specific schema
  // TODO: HADBのストアドプロシージャについて確認
  async getStoredProcedures(schema?: string): Promise<string[]> {
    if (!this.connection) throw new Error("Not connected to database");
    const schemaToUse = schema || "PUBLIC";
    const result = await this.connection.query(
      `SELECT ROUTINE_NAME 
      FROM INFORMATION_SCHEMA.ROUTINES 
      WHERE ROUTINE_SCHEMA = ? 
      ORDER BY ROUTINE_NAME`,
        [schemaToUse]
      );
    return result.map((row: any) => row.ROUTINE_NAME);
  }

  // Get details for a specific stored procedure/function
  // TODO: HADBのストアドプロシージャについて確認
  async getStoredProcedureDetail(procedureName: string, schema?: string): Promise<StoredProcedure> {
    if (!this.connection) throw new Error("Not connected to database");
    const schemaToUse = schema || "PUBLIC";
    const result = await this.connection.query(
      `SELECT ROUTINE_NAME, ROUTINE_TYPE, DATA_TYPE AS RETURN_TYPE, ROUTINE_DEFINITION
       FROM INFORMATION_SCHEMA.ROUTINES
       WHERE ROUTINE_SCHEMA = ? AND ROUTINE_NAME = ?`,
        [schemaToUse, procedureName]
      );
    const rows = result as any[];
    if (rows.length === 0) {
      throw new Error(`Stored procedure '${procedureName}' not found in schema '${schemaToUse}'`);
      }
    const proc = rows[0];
    // パラメータ取得
    const paramResult = await this.connection.query(
      `SELECT PARAMETER_NAME, PARAMETER_MODE, DATA_TYPE
       FROM INFORMATION_SCHEMA.PARAMETERS
       WHERE SPECIFIC_SCHEMA = ? AND SPECIFIC_NAME = ? AND PARAMETER_NAME IS NOT NULL
       ORDER BY ORDINAL_POSITION`,
      [schemaToUse, procedureName]
    );
    const parameter_list = paramResult
      .map((p: any) => `${p.PARAMETER_NAME} ${p.PARAMETER_MODE} ${p.DATA_TYPE}`)
      .join(", ");
      return {
      procedure_name: proc.ROUTINE_NAME,
      procedure_type: proc.ROUTINE_TYPE.toLowerCase(),
      language: "sql",
      parameter_list,
      return_type: proc.RETURN_TYPE,
      definition: proc.ROUTINE_DEFINITION,
      };
  }

  async executeSQL(sql: string): Promise<SQLResult> {
    if (!this.connection) throw new Error("Not connected to database");
    // 複数文対応
    const statements = sql.split(";").map(s => s.trim()).filter(s => s.length > 0);
        let allRows: any[] = [];
    //postgresではBEGIN文を実行し、トランザクションを開始していた
    //複数SQLを１トランザクションの中で実行するためにBEGINN文を使用している
    // TODO: HADBではBEGIN文が必要か確認
    for (const statement of statements) {
      const result = await this.connection.query(statement);
      if (Array.isArray(result) && result.length > 0) {
        allRows.push(...result);
            }
          }
        return { rows: allRows };
    }
}

// コネクタ登録
const hadbConnector = new HADBConnector();
ConnectorRegistry.register(hadbConnector);