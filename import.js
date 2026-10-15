
const XLSX = require("xlsx");
const mysql = require("mysql2/promise");
const path = require("path");

async function main() {
  let connection;

  try {
    // 1. 엑셀 파일 읽기
    const filePath = path.join(__dirname, "salary-data.xlsx");
    const workbook = XLSX.readFile(filePath);
    const sheet = workbook.Sheets["연봉Data"];

    if (!sheet) {
      throw new Error("엑셀 시트 '연봉Data'를 찾을 수 없습니다.");
    }

    const rows = XLSX.utils.sheet_to_json(sheet, {
      defval: null,
    });

    console.log(`엑셀에서 ${rows.length}행을 읽었습니다.`);

    // 2. MariaDB 연결
    connection = await mysql.createConnection({
      host: "127.0.0.1",
      port: 3306,
      user: "salary_app",
      password: "LocalSalary_2026!",
      database: "searchdb",
    });

    console.log("MariaDB 접속 성공!");

    // 3. 엑셀 열을 데이터베이스 형식으로 변환
    const data = rows
      .filter(
        (row) =>
          row["회사명"] != null &&
          String(row["회사명"]).trim() !== ""
      )
      .map((row) => {
        const rawAmount = row["보수총액"];
        const amountText =
          rawAmount == null ? "" : String(rawAmount).replace(/,/g, "").trim();

        const amount =
          amountText === "" ? null : Number(amountText);

        return [
          String(row["회사명"]).trim(),
          Number(row["결산기준일"]),
          String(row["이름"] ?? "-").trim() || "-",
          String(row["직위"] ?? "-").trim() || "-",
          amount !== null && Number.isFinite(amount)
            ? Math.round(amount)
            : null,
        ];
      });

    // 4. 데이터를 500행씩 저장
    await connection.beginTransaction();

    // 주의: 기존 salary_data 내용이 삭제됩니다.
    await connection.query("DELETE FROM salary_data");

    const batchSize = 500;

    for (let i = 0; i < data.length; i += batchSize) {
      const batch = data.slice(i, i + batchSize);

      await connection.query(
        `INSERT INTO salary_data
         (company_name, fiscal_year, employee_name, position_name, compensation)
         VALUES ?`,
        [batch]
      );

      console.log(
        `저장 진행: ${Math.min(i + batch.length, data.length)} / ${data.length}`
      );
    }

    await connection.commit();

    console.log(`완료! 총 ${data.length}행을 저장했습니다.`);
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }

    console.error("오류가 발생했습니다:", error.message);
    process.exitCode = 1;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

main();
