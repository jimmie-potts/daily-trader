export type SqlRow = Readonly<Record<string, unknown>>;

export interface SqlQueryResult<Row extends SqlRow = SqlRow> {
  readonly rows: readonly Row[];
  readonly rowCount: number | null;
}

export interface SqlClient {
  query<Row extends SqlRow = SqlRow>(
    text: string,
    parameters?: readonly unknown[],
  ): Promise<SqlQueryResult<Row>>;
  release(): void;
}

export interface SqlPool {
  connect(): Promise<SqlClient>;
  query<Row extends SqlRow = SqlRow>(
    text: string,
    parameters?: readonly unknown[],
  ): Promise<SqlQueryResult<Row>>;
  end(): Promise<void>;
  destroy(): Promise<void>;
}
