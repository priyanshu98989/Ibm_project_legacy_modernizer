package com.bank.service;

import com.bank.model.Account;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.Hashtable;
import java.util.Stack;
import java.util.Vector;
import java.util.Enumeration;

/**
 * AccountService.java — Legacy banking service.
 *
 * Known issues (intentional for demo):
 *   - Hashtable instead of HashMap (pre-Java-5 synchronised collection)
 *   - Stack instead of Deque
 *   - Raw JDBC without try-with-resources (resource leak)
 *   - Deep nesting (complexity)
 *   - Thread.sleep in business logic
 *   - System.exit on error
 *   - catch(Exception) — swallowed errors
 *   - No unit tests
 */
public class AccountService {

    // TODO: move to config file
    private static final String DB_URL  = "jdbc:db2://192.168.1.100:50000/BANKDB";
    private static final String DB_USER = "admin";
    private static final String DB_PASS = "password123";   // FIXME: never hardcode credentials

    private Hashtable accountCache;        // raw Hashtable — should be ConcurrentHashMap<Integer,Account>
    private Stack     pendingTransactions; // raw Stack     — should be Deque<Transaction>

    public AccountService() {
        accountCache        = new Hashtable();
        pendingTransactions = new Stack();
    }

    /**
     * Load an account from DB by ID.
     * Uses raw JDBC without try-with-resources — connection and statement are never guaranteed to close.
     */
    @Deprecated
    public Account loadAccount(int accountId) {
        Connection conn  = null;
        Statement  stmt  = null;
        ResultSet  rs    = null;
        try {
            conn = DriverManager.getConnection(DB_URL, DB_USER, DB_PASS);
            stmt = conn.createStatement();
            rs   = stmt.executeQuery("SELECT * FROM ACCOUNTS WHERE ID=" + accountId);  // SQL injection risk

            if (rs.next()) {
                String type = rs.getString("TYPE");
                Account acct = new Account(accountId, type, rs.getString("OWNER"));
                acct.setBalance(rs.getDouble("BALANCE"));

                if (type != null) {
                    if (type.equals("SAVINGS")) {
                        if (acct.getBalance() >= 0) {
                            if (acct.getBalance() > 1000) {
                                if (acct.getBalance() > 10000) {
                                    if (acct.getBalance() > 100000) {
                                        // Level 6 nesting
                                        acct.recordTransaction("VIP_TIER");
                                    }
                                }
                            }
                        } else {
                            if (acct.getBalance() < -100) {
                                System.exit(1);  // HACK: terminate on overdraft — replace with exception
                            }
                        }
                    } else if (type.equals("CHECKING")) {
                        // TODO: apply different interest rules
                    }
                }
                accountCache.put(accountId, acct);  // unchecked put into raw Hashtable
                return acct;
            }
        } catch (Exception e) {  // anti-pattern: catch Exception
            e.printStackTrace();
        } finally {
            // Manual resource cleanup — should use try-with-resources
            try { if (rs   != null) rs.close();   } catch (Exception e) { /* swallow */ }
            try { if (stmt != null) stmt.close();  } catch (Exception e) { /* swallow */ }
            try { if (conn != null) conn.close();  } catch (Exception e) { /* swallow */ }
        }
        return null;
    }

    /**
     * Process all pending transactions in the stack.
     * Uses Thread.sleep — anti-pattern in business logic.
     */
    public void flushTransactions() {
        while (!pendingTransactions.isEmpty()) {
            Object tx = pendingTransactions.pop();   // unchecked cast needed next line
            String desc = (String) tx;               // explicit unchecked cast
            try {
                Thread.sleep(50);  // FIXME: rate limiting should not use sleep
            } catch (Exception e) {
                // swallow
            }
        }
    }

    /**
     * Batch-load accounts from a list.
     */
    public Vector batchLoad(Vector accountIds) {   // raw Vector in/out signature
        Vector results = new Vector();
        Enumeration e = accountIds.elements();
        while (e.hasMoreElements()) {
            Integer id = (Integer) e.nextElement(); // unchecked cast
            Account a  = loadAccount(id);
            if (a != null) results.addElement(a);   // raw add
        }
        return results;
    }

    // FIXME: add proper interest calculation
    // TODO: implement transaction rollback
    // HACK: bypasses audit trail for batch ops
    // TODO: add unit tests — critical path has zero test coverage
    // FIXME: connection pool not implemented
}
