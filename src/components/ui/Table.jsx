import React from "react";
import DataTable from "./DataTable";

const Table = ({
  children,
  className = "",
  tableClassName = "",
  minWidth = "min-w-full",
}) => {
  return (
    <DataTable
      className={className}
      tableClassName={tableClassName}
      minWidth={minWidth}
    >
      {children}
    </DataTable>
  );
};

export default Table;
