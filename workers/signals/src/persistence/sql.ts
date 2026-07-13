export type SqlRow = Readonly<Record<string, unknown>>;

export interface SqlQueryResult<Row extends SqlRow = SqlRow> {
  readonly rows: readonly Row[];
  readonly rowCount: number | null;
}

export interface SqlQueryable {
  query<Row extends SqlRow = SqlRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<SqlQueryResult<Row>>;
}

export interface SqlClient extends SqlQueryable {
  release(): void;
}

export interface SqlPool extends SqlQueryable {
  connect(): Promise<SqlClient>;
  end(): Promise<void>;
  destroy(): Promise<void>;
}
