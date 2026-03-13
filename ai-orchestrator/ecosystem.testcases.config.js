module.exports = {
  "apps": [
    {
      "name": "testcase-scheduler",
      "script": "/home/user/webapp/ai-orchestrator/src/testcases/autoScheduler.js",
      "args": "--run-on-start",
      "cwd": "/home/user/webapp/ai-orchestrator",
      "instances": 1,
      "autorestart": true,
      "watch": false,
      "max_memory_restart": "200M",
      "env": {
        "NODE_ENV": "production"
      },
      "log_file": "/home/user/webapp/ai-orchestrator/src/testcases/pm2_combined.log",
      "out_file": "/home/user/webapp/ai-orchestrator/src/testcases/pm2_out.log",
      "error_file": "/home/user/webapp/ai-orchestrator/src/testcases/pm2_err.log",
      "time": true,
      "cron_restart": "0 3 * * *"
    }
  ]
};
