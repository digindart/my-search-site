
const express = require("express");
const mysql = require("mysql2/promise");
const path = require("path");

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(__dirname));

const dbConfig = {
  host: "127.0.0.1",
  port: 3306,
  user: "salary_app",
  password: "LocalSalary_2026!",
  database: "searchdb",
};

// 홈페이지 열기
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

 // 회사명 자동완성 API
 app.get("/api/suggest", async (req, res) => {
    const company = String(req.query.company || "").trim();
  
    if (company.length < 2) {
      return res.json([]);
    }
  
    let connection;
  
    try {
      connection = await mysql.createConnection(dbConfig);
  
      const [rows] = await connection.execute(
        `SELECT DISTINCT company_name
         FROM salary_data
         WHERE company_name LIKE ?
         ORDER BY company_name
         LIMIT 5`,
        [`%${company}%`]
      );
  
      res.json(rows.map(row => row.company_name));
    } catch (error) {
      console.error("자동완성 오류:", error.message);
      res.status(500).json({
        error: "회사명 추천 중 오류가 발생했습니다."
      });
    } finally {
      if (connection) await connection.end();
    }
  });
  
// 회사명 검색 API

// 회사명 검색 API
app.get("/api/search", async (req, res) => {
    const company = String(req.query.company || "").trim();
    const year = String(req.query.year || "").trim();
    const sort = String(req.query.sort || "year");
  
    if (!company) {
      return res.json([]);
    }
  
    let connection;
  
    try {
      connection = await mysql.createConnection(dbConfig);
  
      let sql = `
        SELECT company_name, fiscal_year,
               employee_name, position_name, compensation
        FROM salary_data
        WHERE company_name = ?
      `;
  
      const params = [company];
  
      if (year) {
        if (!/^\d{4}$/.test(year)) {
          return res.status(400).json({
            error: "올바른 연도를 입력해주세요."
          });
        }
  
        sql += " AND fiscal_year = ?";
        params.push(Number(year));
      }
  
      if (sort === "salary") {
        sql += " ORDER BY compensation DESC, fiscal_year DESC";
      } else {
        sql += " ORDER BY fiscal_year DESC, compensation DESC";
      }
  
      const [rows] = await connection.execute(sql, params);
      res.json(rows);
  
    } catch (error) {
      console.error("검색 오류:", error.message);
      res.status(500).json({
        error: "검색 중 오류가 발생했습니다."
      });
    } finally {
      if (connection) await connection.end();
    }
  });
  
  // 결산연도 목록 API
  app.get("/api/years", async (req, res) => {
    let connection;
  
    try {
      connection = await mysql.createConnection(dbConfig);
  
      const [rows] = await connection.execute(
        `SELECT DISTINCT fiscal_year
         FROM salary_data
         WHERE fiscal_year IS NOT NULL
         ORDER BY fiscal_year DESC`
      );
  
      res.json(rows.map(row => row.fiscal_year));
    } catch (error) {
      console.error("연도 조회 오류:", error.message);
      res.status(500).json({
        error: "연도 목록을 불러오지 못했습니다."
      });
    } finally {
      if (connection) await connection.end();
    }
  });
  

app.listen(PORT, () => {
  console.log(`웹사이트 주소: http://localhost:${PORT}`);
});
