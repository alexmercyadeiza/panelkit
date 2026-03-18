import { describe, it, expect } from "bun:test";
import {
  buildConnectionString,
  buildConnectionStrings,
  encodePassword,
} from "../../server/lib/connection-string";

describe("Connection String — encodePassword", () => {
  it("encodes special characters", () => {
    const encoded = encodePassword("p@ss:w/ord?#");
    expect(encoded).toBe("p%40ss%3Aw%2Ford%3F%23");
  });

  it("leaves alphanumeric chars untouched", () => {
    expect(encodePassword("abc123")).toBe("abc123");
  });

  it("encodes spaces", () => {
    expect(encodePassword("pass word")).toBe("pass%20word");
  });
});

describe("Connection String — buildConnectionString", () => {
  it("generates correct MySQL format", () => {
    const conn = buildConnectionString({
      type: "mysql",
      username: "user",
      password: "pass",
      host: "localhost",
      port: 3306,
      dbName: "mydb",
    });

    expect(conn).toBe("mysql://user:pass@localhost:3306/mydb");
  });

  it("generates correct PostgreSQL format", () => {
    const conn = buildConnectionString({
      type: "postgresql",
      username: "user",
      password: "pass",
      host: "localhost",
      port: 5432,
      dbName: "mydb",
    });

    expect(conn).toBe("postgresql://user:pass@localhost:5432/mydb");
  });

  it("URL-encodes special characters in password", () => {
    const conn = buildConnectionString({
      type: "mysql",
      username: "user",
      password: "p@ss!w#rd",
      host: "localhost",
      port: 3306,
      dbName: "mydb",
    });

    expect(conn).toContain("p%40ss!w%23rd");
    expect(conn).not.toContain("p@ss");
  });

  it("includes sslmode for PostgreSQL when configured", () => {
    const conn = buildConnectionString({
      type: "postgresql",
      username: "user",
      password: "pass",
      host: "db.example.com",
      port: 5432,
      dbName: "mydb",
      ssl: true,
    });

    expect(conn).toContain("?sslmode=require");
  });

  it("does not include sslmode for MySQL", () => {
    const conn = buildConnectionString({
      type: "mysql",
      username: "user",
      password: "pass",
      host: "localhost",
      port: 3306,
      dbName: "mydb",
      ssl: true,
    });

    expect(conn).not.toContain("sslmode");
  });

  it("does not include sslmode for PostgreSQL when ssl is false", () => {
    const conn = buildConnectionString({
      type: "postgresql",
      username: "user",
      password: "pass",
      host: "localhost",
      port: 5432,
      dbName: "mydb",
      ssl: false,
    });

    expect(conn).not.toContain("sslmode");
  });
});

describe("Connection String — buildConnectionStrings", () => {
  it("returns internal (localhost) connection string", () => {
    const { internal } = buildConnectionStrings({
      type: "mysql",
      username: "user",
      password: "pass",
      host: "db.example.com",
      port: 3306,
      dbName: "mydb",
    });

    expect(internal).toContain("localhost");
  });

  it("returns external connection string when externalHost provided", () => {
    const { internal, external } = buildConnectionStrings({
      type: "postgresql",
      username: "user",
      password: "pass",
      host: "localhost",
      port: 5432,
      dbName: "mydb",
      externalHost: "203.0.113.1",
    });

    expect(internal).toContain("localhost");
    expect(external).toBeDefined();
    expect(external).toContain("203.0.113.1");
  });

  it("external is undefined when no externalHost", () => {
    const { external } = buildConnectionStrings({
      type: "mysql",
      username: "user",
      password: "pass",
      host: "localhost",
      port: 3306,
      dbName: "mydb",
    });

    expect(external).toBeUndefined();
  });
});
