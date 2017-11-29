type QueryType = number | string | boolean;

interface IBuilderResult {
  text: string;
  values: QueryType[];
}

interface IBuilder {
  (query: QueryType[]) : IBuilderResult;
}

declare class SimpleBuilder {
  pg: IBuilder;
  mysql: IBuilder;
}
  
declare module 'simple-builder' {
  export const pg: IBuilder;
  export const mysql: IBuilder;
}
