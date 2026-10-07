import React from "react";

const cx = (...classes) => classes.filter(Boolean).join(" ");

const alignClasses = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

function DataTable({
  children,
  className = "",
  tableClassName = "",
  minWidth = "min-w-full",
}) {
  return (
    <div className={cx("overflow-x-auto", className)}>
      <table
        className={cx(
          minWidth,
          "divide-y divide-slate-200 text-sm",
          tableClassName,
        )}
      >
        {children}
      </table>
    </div>
  );
}

function DataTableHeader({ children, className = "" }) {
  return <thead className={cx("bg-slate-50", className)}>{children}</thead>;
}

function DataTableBody({ children, className = "" }) {
  return <tbody className={cx("divide-y divide-slate-100 bg-white", className)}>{children}</tbody>;
}

function DataTableRow({ children, interactive = true, className = "", ...props }) {
  return (
    <tr
      className={cx(
        interactive && "transition hover:bg-blue-50/30",
        className,
      )}
      {...props}
    >
      {children}
    </tr>
  );
}

function DataTableHeadCell({
  children,
  align = "left",
  className = "",
  ...props
}) {
  return (
    <th
      className={cx(
        "whitespace-nowrap px-5 py-3 text-xs font-bold uppercase text-slate-500",
        alignClasses[align] || alignClasses.left,
        className,
      )}
      {...props}
    >
      {children}
    </th>
  );
}

function DataTableCell({
  children,
  align = "left",
  className = "",
  muted = false,
  strong = false,
  mono = false,
  ...props
}) {
  return (
    <td
      className={cx(
        "px-5 py-4",
        alignClasses[align] || alignClasses.left,
        muted && "text-slate-500",
        strong && "font-bold text-slate-900",
        mono && "font-mono text-xs font-bold",
        className,
      )}
      {...props}
    >
      {children}
    </td>
  );
}

function DataTableEmpty({ children, colSpan = 1, className = "" }) {
  return (
    <tr>
      <td colSpan={colSpan} className={cx("px-5 py-8", className)}>
        {children}
      </td>
    </tr>
  );
}

DataTable.Header = DataTableHeader;
DataTable.Body = DataTableBody;
DataTable.Row = DataTableRow;
DataTable.HeadCell = DataTableHeadCell;
DataTable.Cell = DataTableCell;
DataTable.Empty = DataTableEmpty;

export default DataTable;
