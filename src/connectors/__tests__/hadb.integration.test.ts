import { describe, it, expect, beforeAll, afterAll } from 'vitest';
// PostgreSQL用のtestcontainersは削除
// import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
// import { PostgresConnector } from '../postgres/index.js';
import { HADBConnector } from '../hadb/index.js'; // HADB用コネクタをインポート
import { IntegrationTestBase, type TestContainer, type DatabaseTestConfig } from './shared/integration-test-base.js';
import type { Connector } from '../interface.js';

// HADB用のテストコンテナクラス（必要に応じて実装を追加）
class HADBTestContainer implements TestContainer {
  // HADBの接続情報を返す
  getConnectionUri(): string {
    // 実際のHADB接続URIを返すように修正してください
    return process.env.HADB_TEST_DSN || "";
  }
  async stop(): Promise<void> {
    // HADBのクリーンアップ処理があればここに記述
  }
}

// HADB用のIntegrationTestクラス
class HADBIntegrationTest extends IntegrationTestBase<HADBTestContainer> {
  constructor() {
    const config: DatabaseTestConfig = {
      expectedSchemas: ['public', 'test_schema'],
      expectedTables: ['users', 'orders'],
      expectedTestSchemaTable: 'products',
      testSchema: 'test_schema',
      supportsStoredProcedures: true,
      expectedStoredProcedures: ['get_user_count', 'calculate_total_age']
    };
    super(config);
  }

  async createContainer(): Promise<HADBTestContainer> {
    // HADBのテスト用コンテナや接続先をセットアップ
    return new HADBTestContainer();
  }

  createConnector(): Connector {
    return new HADBConnector();
  }

  //SSL is not supported in HADB, so we skip this test
  createSSLTests(): void {
    // HADBでSSLテストが必要な場合はここに実装
    describe('HADB SSL Connection Tests', () => {
      it('should handle SSL mode disable connection', async () => {
        // 実装は必要に応じて追加
      });
      it('should handle SSL mode require connection', async () => {
        // 実装は必要に応じて追加
      });
    });
  }

  //TODO: SQL文は見直し
  async setupTestData(connector: Connector): Promise<void> {
    // ここはSQL文を後で修正するので、現状のまま
    // Create table
    await connector.executeSQL('CREATE SCHEMA IF NOT EXISTS test_schema');
    await connector.executeSQL(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        age INTEGER
      )
    `);

    // Create orders table
    await connector.executeSQL(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        total DECIMAL(10,2),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create products table in test_schema
    await connector.executeSQL(`
      CREATE TABLE IF NOT EXISTS test_schema.products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        price DECIMAL(10,2)
      )
    `);

    // Insert test data
    await connector.executeSQL(`
      INSERT INTO users (name, email, age) VALUES 
      ('John Doe', 'john@example.com', 30),
      ('Jane Smith', 'jane@example.com', 25),
      ('Bob Johnson', 'bob@example.com', 35)
      ON CONFLICT (email) DO NOTHING
    `);

    await connector.executeSQL(`
      INSERT INTO orders (user_id, total) VALUES 
      (1, 99.99),
      (1, 149.50),
      (2, 75.25)
      ON CONFLICT DO NOTHING
    `);

    await connector.executeSQL(`
      INSERT INTO test_schema.products (name, price) VALUES 
      ('Widget A', 19.99),
      ('Widget B', 29.99)
      ON CONFLICT DO NOTHING
    `);

    // Create test stored procedures using SQL language to avoid dollar quoting
    await connector.executeSQL(`
      CREATE OR REPLACE FUNCTION get_user_count()
      RETURNS INTEGER
      LANGUAGE SQL
      AS 'SELECT COUNT(*)::INTEGER FROM users'
    `);

    await connector.executeSQL(`
      CREATE OR REPLACE FUNCTION calculate_total_age()
      RETURNS INTEGER
      LANGUAGE SQL  
      AS 'SELECT COALESCE(SUM(age), 0)::INTEGER FROM users WHERE age IS NOT NULL'
    `);
  }
}

// テストスイートの作成
const hadbTest = new HADBIntegrationTest();

describe('HADB Connector Integration Tests', () => {
  beforeAll(async () => {
    await hadbTest.setup();
  }, 120000);

  afterAll(async () => {
    await hadbTest.cleanup();
  });

  // 共通テストを実行
  hadbTest.createConnectionTests();
  hadbTest.createSchemaTests();
  hadbTest.createTableTests();
  hadbTest.createSQLExecutionTests();
  if (hadbTest.config.supportsStoredProcedures) {
    hadbTest.createStoredProcedureTests();
  }
  hadbTest.createErrorHandlingTests();
  hadbTest.createSSLTests();

  // HADB固有のテスト（必要に応じて追加）
  describe('HADB-specific Features', () => {
    it('should execute multiple statements with transaction support', async () => {
      const result = await hadbTest.connector.executeSQL(`
        INSERT INTO users (name, email, age) VALUES ('Multi User 1', 'multi1@example.com', 30);
        INSERT INTO users (name, email, age) VALUES ('Multi User 2', 'multi2@example.com', 35);
        SELECT COUNT(*) as total FROM users WHERE email LIKE 'multi%';
      `);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].total).toBe('2');
    });

    it('should handle HADB-specific data types', async () => {
      await hadbTest.connector.executeSQL(`
        CREATE TABLE IF NOT EXISTS hadb_types_test (
          id SERIAL PRIMARY KEY,
          json_data VARCHAR(1000),
          uuid_val VARCHAR(36),
          array_val VARCHAR(100),
          timestamp_val TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await hadbTest.connector.executeSQL(`
        INSERT INTO hadb_types_test (json_data, array_val) 
        VALUES ('{"key": "value"}', '[1,2,3,4,5]')
      `);

      const result = await hadbTest.connector.executeSQL(
        'SELECT * FROM hadb_types_test ORDER BY id DESC LIMIT 1'
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].json_data).toBeDefined();
      expect(result.rows[0].uuid_val).toBeDefined();
      expect(result.rows[0].array_val).toBeDefined();
    });

    //Todo: returning clause is not supported in HADB, so we skip this test
    /*
    it('should handle HADB returning clause', async () => {
      const result = await hadbTest.connector.executeSQL(
        "INSERT INTO users (name, email, age) VALUES ('Returning Test', 'returning@example.com', 40) RETURNING id, name"
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].id).toBeDefined();
      expect(result.rows[0].name).toBe('Returning Test');
    });
    */

    it('should work with HADB-specific functions', async () => {
      const result = await hadbTest.connector.executeSQL(`
        SELECT 
          CURRENT_USER as current_user,
          CURRENT_TIMESTAMP as current_time
      `);
      
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].current_user).toBeDefined();
      expect(result.rows[0].current_time).toBeDefined();
    });

    it('should handle HADB transactions correctly', async () => {
      // Test rollback on error
      await expect(
        hadbTest.connector.executeSQL(`
          BEGIN;
          INSERT INTO users (name, email, age) VALUES ('Transaction Test', 'trans@example.com', 40);
          INSERT INTO users (name, email, age) VALUES ('Transaction Test', 'trans@example.com', 40); -- This should fail due to unique constraint
          COMMIT;
        `)
      ).rejects.toThrow();
      // Verify rollback worked
      const result = await hadbTest.connector.executeSQL(
        "SELECT COUNT(*) as count FROM users WHERE email = 'trans@example.com'"
      );
      expect(result.rows[0].count).toBe('0');
    });

    it('should handle HADB window functions', async () => {
      const result = await hadbTest.connector.executeSQL(`
        SELECT 
          name,
          age,
          ROW_NUMBER() OVER (ORDER BY age DESC) as age_rank
        FROM users
        WHERE age IS NOT NULL
        ORDER BY age DESC
      `);
      expect(result.rows.length).toBeGreaterThan(0);
      expect(result.rows[0]).toHaveProperty('age_rank');
    });

    // Todo：HADBにはJSONの操作はないはず、要確認
    it('should handle HADB arrays and JSON operations', async () => {
      await hadbTest.connector.executeSQL(`
        CREATE TABLE IF NOT EXISTS json_test (
          id SERIAL PRIMARY KEY,
          data VARCHAR(1000)
        )
      `);

      await hadbTest.connector.executeSQL(`
        INSERT INTO json_test (data) VALUES 
        ('{"name": "John", "tags": ["admin", "user"], "settings": {"theme": "dark"}}'),
        ('{"name": "Jane", "tags": ["user"], "settings": {"theme": "light"}}')
      `);

      const result = await hadbTest.connector.executeSQL(`
        SELECT 
          data
        FROM json_test
      `);
      expect(result.rows.length).toBeGreaterThan(0);
      expect(result.rows[0].data).toBeDefined();
    });

  });
});