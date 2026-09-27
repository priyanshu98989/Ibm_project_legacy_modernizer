package com.bank;

import com.bank.service.AccountService;
import com.bank.service.AuditService;
import com.bank.model.Account;
import java.util.Vector;

/**
 * BankApplication.java — Legacy main entry point.
 * Wires AccountService and AuditService together.
 * Creates dependency edges for the graph: BankApplication → AccountService, AuditService
 */
public class BankApplication {

    public static void main(String[] args) {
        AccountService accountSvc = new AccountService();
        AuditService   auditSvc   = new AuditService();

        // Batch-load using legacy Vector API
        Vector ids = new Vector();
        ids.addElement(1001);
        ids.addElement(1002);
        ids.addElement(1003);

        Vector accounts = accountSvc.batchLoad(ids);   // raw Vector
        for (int i = 0; i < accounts.size(); i++) {
            Account a = (Account) accounts.elementAt(i); // unchecked cast
            auditSvc.logEvent("LOADED", String.valueOf(a.getAccountNumber()));
        }

        accountSvc.flushTransactions();
        auditSvc.flushLog();
    }
}
