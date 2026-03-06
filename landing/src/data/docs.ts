export interface CommandFlag {
  flag: string
  descriptionKey: string
  required?: boolean
}

export interface Command {
  name: string
  descriptionKey: string
  usage: string
  flags?: CommandFlag[]
  examples?: string[]
}

export interface CommandGroup {
  id: string
  titleKey: string
  descriptionKey: string
  commands: Command[]
}

export interface DocSection {
  id: string
  titleKey: string
  children?: { id: string; titleKey: string }[]
}

export const sidebarSections: DocSection[] = [
  {
    id: 'getting-started',
    titleKey: 'docs.sidebar.gettingStarted',
    children: [
      { id: 'prerequisites', titleKey: 'docs.sidebar.prerequisites' },
      { id: 'installation', titleKey: 'docs.sidebar.installation' },
      { id: 'first-deploy', titleKey: 'docs.sidebar.firstDeploy' },
    ],
  },
  {
    id: 'cli-reference',
    titleKey: 'docs.sidebar.cliReference',
    children: [
      { id: 'authentication', titleKey: 'docs.sidebar.authentication' },
      { id: 'services', titleKey: 'docs.sidebar.services' },
      { id: 'domains', titleKey: 'docs.sidebar.domains' },
      { id: 'backups', titleKey: 'docs.sidebar.backups' },
      { id: 'ssh-keys', titleKey: 'docs.sidebar.sshKeys' },
      { id: 'marketplace', titleKey: 'docs.sidebar.marketplace' },
      { id: 'infrastructure', titleKey: 'docs.sidebar.infrastructure' },
    ],
  },
  {
    id: 'storage',
    titleKey: 'docs.sidebar.storage',
    children: [
      { id: 'storage-overview', titleKey: 'docs.sidebar.storageOverview' },
      { id: 'storage-providers', titleKey: 'docs.sidebar.storageProviders' },
      { id: 'storage-node-setup', titleKey: 'docs.sidebar.storageNodeSetup' },
      { id: 'storage-specs', titleKey: 'docs.sidebar.storageSpecs' },
      { id: 'storage-migration', titleKey: 'docs.sidebar.storageMigration' },
    ],
  },
  {
    id: 'networking',
    titleKey: 'docs.sidebar.networking',
    children: [
      { id: 'networking-ports', titleKey: 'docs.sidebar.networkingPorts' },
      { id: 'networking-firewall', titleKey: 'docs.sidebar.networkingFirewall' },
      { id: 'networking-sftp', titleKey: 'docs.sidebar.networkingSftp' },
    ],
  },
  {
    id: 'integrations',
    titleKey: 'docs.sidebar.integrations',
    children: [
      { id: 'deploy-button', titleKey: 'docs.sidebar.deployButton' },
      { id: 'fleet-json', titleKey: 'docs.sidebar.fleetJson' },
    ],
  },
  {
    id: 'configuration',
    titleKey: 'docs.sidebar.configuration',
  },
]

export const commandGroups: CommandGroup[] = [
  {
    id: 'authentication',
    titleKey: 'docs.cmd.auth.title',
    descriptionKey: 'docs.cmd.auth.desc',
    commands: [
      {
        name: 'siglar login',
        descriptionKey: 'docs.cmd.auth.loginDesc',
        usage: 'siglar login [options]',
        flags: [
          { flag: '--api-url <url>', descriptionKey: 'docs.cmd.auth.loginFlagApiUrl' },
        ],
        examples: [
          '$ siglar login',
          '$ siglar login --api-url https://siglar.example.com',
        ],
      },
      {
        name: 'siglar logout',
        descriptionKey: 'docs.cmd.auth.logoutDesc',
        usage: 'siglar logout',
        examples: ['$ siglar logout'],
      },
      {
        name: 'siglar whoami',
        descriptionKey: 'docs.cmd.auth.whoamiDesc',
        usage: 'siglar whoami',
        examples: ['$ siglar whoami'],
      },
    ],
  },
  {
    id: 'services',
    titleKey: 'docs.cmd.services.title',
    descriptionKey: 'docs.cmd.services.desc',
    commands: [
      {
        name: 'siglar deploy',
        descriptionKey: 'docs.cmd.services.deployDesc',
        usage: 'siglar deploy --name <name> --image <image> [options]',
        flags: [
          { flag: '--name <name>', descriptionKey: 'docs.cmd.services.deployFlagName', required: true },
          { flag: '--image <image>', descriptionKey: 'docs.cmd.services.deployFlagImage', required: true },
          { flag: '--replicas <n>', descriptionKey: 'docs.cmd.services.deployFlagReplicas' },
          { flag: '--env <KEY=VAL>', descriptionKey: 'docs.cmd.services.deployFlagEnv' },
        ],
        examples: [
          '$ siglar deploy --name my-app --image node:20',
          '$ siglar deploy --name api --image myapp:latest --replicas 3 --env PORT=8080 --env NODE_ENV=production',
        ],
      },
      {
        name: 'siglar services',
        descriptionKey: 'docs.cmd.services.listDesc',
        usage: 'siglar services',
        examples: ['$ siglar services'],
      },
      {
        name: 'siglar logs',
        descriptionKey: 'docs.cmd.services.logsDesc',
        usage: 'siglar logs <service> [options]',
        flags: [
          { flag: '-f, --follow', descriptionKey: 'docs.cmd.services.logsFlagFollow' },
          { flag: '--tail <n>', descriptionKey: 'docs.cmd.services.logsFlagTail' },
        ],
        examples: [
          '$ siglar logs my-app',
          '$ siglar logs my-app --tail 50',
        ],
      },
      {
        name: 'siglar scale',
        descriptionKey: 'docs.cmd.services.scaleDesc',
        usage: 'siglar scale <service> <replicas>',
        examples: ['$ siglar scale my-app 5'],
      },
      {
        name: 'siglar stop',
        descriptionKey: 'docs.cmd.services.stopDesc',
        usage: 'siglar stop <service>',
        examples: ['$ siglar stop my-app'],
      },
      {
        name: 'siglar start',
        descriptionKey: 'docs.cmd.services.startDesc',
        usage: 'siglar start <service>',
        examples: ['$ siglar start my-app'],
      },
      {
        name: 'siglar restart',
        descriptionKey: 'docs.cmd.services.restartDesc',
        usage: 'siglar restart <service>',
        examples: ['$ siglar restart my-app'],
      },
      {
        name: 'siglar destroy',
        descriptionKey: 'docs.cmd.services.destroyDesc',
        usage: 'siglar destroy <service> [options]',
        flags: [
          { flag: '-f, --force', descriptionKey: 'docs.cmd.services.destroyFlagForce' },
        ],
        examples: [
          '$ siglar destroy my-app',
          '$ siglar destroy my-app --force',
        ],
      },
    ],
  },
  {
    id: 'domains',
    titleKey: 'docs.cmd.domains.title',
    descriptionKey: 'docs.cmd.domains.desc',
    commands: [
      {
        name: 'siglar domains list',
        descriptionKey: 'docs.cmd.domains.listDesc',
        usage: 'siglar domains list',
        examples: ['$ siglar domains list'],
      },
      {
        name: 'siglar domains add',
        descriptionKey: 'docs.cmd.domains.addDesc',
        usage: 'siglar domains add <domain> --service <name>',
        flags: [
          { flag: '--service <name>', descriptionKey: 'docs.cmd.domains.addFlagService', required: true },
        ],
        examples: ['$ siglar domains add app.example.com --service my-app'],
      },
      {
        name: 'siglar domains remove',
        descriptionKey: 'docs.cmd.domains.removeDesc',
        usage: 'siglar domains remove <domain>',
        examples: ['$ siglar domains remove app.example.com'],
      },
    ],
  },
  {
    id: 'backups',
    titleKey: 'docs.cmd.backups.title',
    descriptionKey: 'docs.cmd.backups.desc',
    commands: [
      {
        name: 'siglar backups list',
        descriptionKey: 'docs.cmd.backups.listDesc',
        usage: 'siglar backups list',
        examples: ['$ siglar backups list'],
      },
      {
        name: 'siglar backups create',
        descriptionKey: 'docs.cmd.backups.createDesc',
        usage: 'siglar backups create --service <name>',
        flags: [
          { flag: '--service <name>', descriptionKey: 'docs.cmd.backups.createFlagService', required: true },
        ],
        examples: ['$ siglar backups create --service my-app'],
      },
      {
        name: 'siglar backups restore',
        descriptionKey: 'docs.cmd.backups.restoreDesc',
        usage: 'siglar backups restore <id>',
        examples: ['$ siglar backups restore abc123'],
      },
    ],
  },
  {
    id: 'ssh-keys',
    titleKey: 'docs.cmd.sshKeys.title',
    descriptionKey: 'docs.cmd.sshKeys.desc',
    commands: [
      {
        name: 'siglar ssh-keys list',
        descriptionKey: 'docs.cmd.sshKeys.listDesc',
        usage: 'siglar ssh-keys list',
        examples: ['$ siglar ssh-keys list'],
      },
      {
        name: 'siglar ssh-keys add',
        descriptionKey: 'docs.cmd.sshKeys.addDesc',
        usage: 'siglar ssh-keys add --name <name> --key <pubkey>',
        flags: [
          { flag: '--name <name>', descriptionKey: 'docs.cmd.sshKeys.addFlagName', required: true },
          { flag: '--key <pubkey>', descriptionKey: 'docs.cmd.sshKeys.addFlagKey', required: true },
        ],
        examples: ['$ siglar ssh-keys add --name "MacBook" --key "ssh-ed25519 AAAA..."'],
      },
      {
        name: 'siglar ssh-keys remove',
        descriptionKey: 'docs.cmd.sshKeys.removeDesc',
        usage: 'siglar ssh-keys remove <id>',
        examples: ['$ siglar ssh-keys remove abc123'],
      },
    ],
  },
  {
    id: 'marketplace',
    titleKey: 'docs.cmd.marketplace.title',
    descriptionKey: 'docs.cmd.marketplace.desc',
    commands: [
      {
        name: 'siglar marketplace list',
        descriptionKey: 'docs.cmd.marketplace.listDesc',
        usage: 'siglar marketplace list',
        examples: ['$ siglar marketplace list'],
      },
      {
        name: 'siglar marketplace deploy',
        descriptionKey: 'docs.cmd.marketplace.deployDesc',
        usage: 'siglar marketplace deploy <slug>',
        examples: [
          '$ siglar marketplace deploy wordpress',
          '$ siglar marketplace deploy redis',
        ],
      },
    ],
  },
  {
    id: 'infrastructure',
    titleKey: 'docs.cmd.infrastructure.title',
    descriptionKey: 'docs.cmd.infrastructure.desc',
    commands: [
      {
        name: 'siglar init',
        descriptionKey: 'docs.cmd.infrastructure.initDesc',
        usage: 'siglar init [options]',
        flags: [
          { flag: '-d, --domain <domain>', descriptionKey: 'docs.cmd.infrastructure.initFlagDomain' },
          { flag: '-e, --email <email>', descriptionKey: 'docs.cmd.infrastructure.initFlagEmail' },
        ],
        examples: [
          '$ siglar init',
          '$ siglar init --domain panel.example.com --email admin@example.com',
        ],
      },
      {
        name: 'siglar join',
        descriptionKey: 'docs.cmd.infrastructure.joinDesc',
        usage: 'siglar join [options]',
        flags: [
          { flag: '-t, --token <token>', descriptionKey: 'docs.cmd.infrastructure.joinFlagToken' },
          { flag: '-a, --address <addr>', descriptionKey: 'docs.cmd.infrastructure.joinFlagAddress' },
        ],
        examples: ['$ siglar join --token SWMTKN-1-xxx --address 10.0.0.1:2377'],
      },
      {
        name: 'siglar status',
        descriptionKey: 'docs.cmd.infrastructure.statusDesc',
        usage: 'siglar status',
        examples: ['$ siglar status'],
      },
    ],
  },
]
