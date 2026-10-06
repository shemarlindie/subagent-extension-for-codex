type TableViewProps = {
  /** The header row first. */
  rows: string[][];
};

export function TableView({ rows }: TableViewProps) {
  const [head = [], ...body] = rows;

  return (
    <div className="table-view">
      <table>
        <thead>
          <tr>
            {head.map((cell, index) => (
              <th key={index}>{cell}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {head.map((_, index) => (
                <td key={index}>{row[index] ?? ""}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
