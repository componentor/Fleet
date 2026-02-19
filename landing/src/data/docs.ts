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
        name: 'fleet login',
        descriptionKey: 'docs.cmd.auth.loginDesc',
        usage: 'fleet login [options]',
        flags: [
          { flag: '--api-url <url>', descriptionKey: 'docs.cmd.auth.loginFlagApiUrl' },
        ],
        examples: [
          '$ fleet login',
          '$ fleet login --api-url https://fleet.example.com',
        ],
      },
      {
        name: 'fleet logout',
        descriptionKey: 'docs.cmd.auth.logoutDesc',
        usage: 'fleet logout',
        examples: ['$ fleet logout'],
      },
      {
        name: 'fleet whoami',
        descriptionKey: 'docs.cmd.auth.whoamiDesc',
        usage: 'fleet whoami',
        examples: ['$ fleet whoami'],
      },
    ],
  },
  {
    id: 'services',
    titleKey: 'docs.cmd.services.title',
    descriptionKey: 'docs.cmd.services.desc',
    commands: [
      {
        name: 'fleet deploy',
        descriptionKey: 'docs.cmd.services.deployDesc',
        usage: 'fleet deploy --name <name> --image <image> [options]',
        flags: [
          { flag: '--name <name>', descriptionKey: 'docs.cmd.services.deployFlagName', required: true },
          { flag: '--image <image>', descriptionKey: 'docs.cmd.services.deployFlagImage', required: true },
          { flag: '--replicas <n>', descriptionKey: 'docs.cmd.services.deployFlagReplicas' },
          { flag: '--env <KEY=VAL>', descriptionKey: 'docs.cmd.services.deployFlagEnv' },
        ],
        examples: [
          '$ fleet deploy --name my-app --image node:20',
          '$ fleet deploy --name api --image myapp:latest --replicas 3 --env PORT=8080 --env NODE_ENV=production',
        ],
      },
      {
        name: 'fleet services',
        descriptionKey: 'docs.cmd.services.listDesc',
        usage: 'fleet services',
        examples: ['$ fleet services'],
      },
      {
        name: 'fleet logs',
        descriptionKey: 'docs.cmd.services.logsDesc',
        usage: 'fleet logs <service> [options]',
        flags: [
          { flag: '-f, --follow', descriptionKey: 'docs.cmd.services.logsFlagFollow' },
          { flag: '--tail <n>', descriptionKey: 'docs.cmd.services.logsFlagTail' },
        ],
        examples: [
          '$ fleet logs my-app',
          '$ fleet logs my-app --tail 50',
        ],
      },
      {
        name: 'fleet scale',
        descriptionKey: 'docs.cmd.services.scaleDesc',
        usage: 'fleet scale <service> <replicas>',
        examples: ['$ fleet scale my-app 5'],
      },
      {
        name: 'fleet stop',
        descriptionKey: 'docs.cmd.services.stopDesc',
        usage: 'fleet stop <service>',
        examples: ['$ fleet stop my-app'],
      },
      {
        name: 'fleet start',
        descriptionKey: 'docs.cmd.services.startDesc',
        usage: 'fleet start <service>',
        examples: ['$ fleet start my-app'],
      },
      {
        name: 'fleet restart',
        descriptionKey: 'docs.cmd.services.restartDesc',
        usage: 'fleet restart <service>',
        examples: ['$ fleet restart my-app'],
      },
      {
        name: 'fleet destroy',
        descriptionKey: 'docs.cmd.services.destroyDesc',
        usage: 'fleet destroy <service> [options]',
        flags: [
          { flag: '-f, --force', descriptionKey: 'docs.cmd.services.destroyFlagForce' },
        ],
        examples: [
          '$ fleet destroy my-app',
          '$ fleet destroy my-app --force',
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
        name: 'fleet domains list',
        descriptionKey: 'docs.cmd.domains.listDesc',
        usage: 'fleet domains list',
        examples: ['$ fleet domains list'],
      },
      {
        name: 'fleet domains add',
        descriptionKey: 'docs.cmd.domains.addDesc',
        usage: 'fleet domains add <domain> --service <name>',
        flags: [
          { flag: '--service <name>', descriptionKey: 'docs.cmd.domains.addFlagService', required: true },
        ],
        examples: ['$ fleet domains add app.example.com --service my-app'],
      },
      {
        name: 'fleet domains remove',
        descriptionKey: 'docs.cmd.domains.removeDesc',
        usage: 'fleet domains remove <domain>',
        examples: ['$ fleet domains remove app.example.com'],
      },
    ],
  },
  {
    id: 'backups',
    titleKey: 'docs.cmd.backups.title',
    descriptionKey: 'docs.cmd.backups.desc',
    commands: [
      {
        name: 'fleet backups list',
        descriptionKey: 'docs.cmd.backups.listDesc',
        usage: 'fleet backups list',
        examples: ['$ fleet backups list'],
      },
      {
        name: 'fleet backups create',
        descriptionKey: 'docs.cmd.backups.createDesc',
        usage: 'fleet backups create --service <name>',
        flags: [
          { flag: '--service <name>', descriptionKey: 'docs.cmd.backups.createFlagService', required: true },
        ],
        examples: ['$ fleet backups create --service my-app'],
      },
      {
        name: 'fleet backups restore',
        descriptionKey: 'docs.cmd.backups.restoreDesc',
        usage: 'fleet backups restore <id>',
        examples: ['$ fleet backups restore abc123'],
      },
    ],
  },
  {
    id: 'ssh-keys',
    titleKey: 'docs.cmd.sshKeys.title',
    descriptionKey: 'docs.cmd.sshKeys.desc',
    commands: [
      {
        name: 'fleet ssh-keys list',
        descriptionKey: 'docs.cmd.sshKeys.listDesc',
        usage: 'fleet ssh-keys list',
        examples: ['$ fleet ssh-keys list'],
      },
      {
        name: 'fleet ssh-keys add',
        descriptionKey: 'docs.cmd.sshKeys.addDesc',
        usage: 'fleet ssh-keys add --name <name> --key <pubkey>',
        flags: [
          { flag: '--name <name>', descriptionKey: 'docs.cmd.sshKeys.addFlagName', required: true },
          { flag: '--key <pubkey>', descriptionKey: 'docs.cmd.sshKeys.addFlagKey', required: true },
        ],
        examples: ['$ fleet ssh-keys add --name "MacBook" --key "ssh-ed25519 AAAA..."'],
      },
      {
        name: 'fleet ssh-keys remove',
        descriptionKey: 'docs.cmd.sshKeys.removeDesc',
        usage: 'fleet ssh-keys remove <id>',
        examples: ['$ fleet ssh-keys remove abc123'],
      },
    ],
  },
  {
    id: 'marketplace',
    titleKey: 'docs.cmd.marketplace.title',
    descriptionKey: 'docs.cmd.marketplace.desc',
    commands: [
      {
        name: 'fleet marketplace list',
        descriptionKey: 'docs.cmd.marketplace.listDesc',
        usage: 'fleet marketplace list',
        examples: ['$ fleet marketplace list'],
      },
      {
        name: 'fleet marketplace deploy',
        descriptionKey: 'docs.cmd.marketplace.deployDesc',
        usage: 'fleet marketplace deploy <slug>',
        examples: [
          '$ fleet marketplace deploy wordpress',
          '$ fleet marketplace deploy redis',
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
        name: 'fleet init',
        descriptionKey: 'docs.cmd.infrastructure.initDesc',
        usage: 'fleet init [options]',
        flags: [
          { flag: '-d, --domain <domain>', descriptionKey: 'docs.cmd.infrastructure.initFlagDomain' },
          { flag: '-e, --email <email>', descriptionKey: 'docs.cmd.infrastructure.initFlagEmail' },
        ],
        examples: [
          '$ fleet init',
          '$ fleet init --domain panel.example.com --email admin@example.com',
        ],
      },
      {
        name: 'fleet join',
        descriptionKey: 'docs.cmd.infrastructure.joinDesc',
        usage: 'fleet join [options]',
        flags: [
          { flag: '-t, --token <token>', descriptionKey: 'docs.cmd.infrastructure.joinFlagToken' },
          { flag: '-a, --address <addr>', descriptionKey: 'docs.cmd.infrastructure.joinFlagAddress' },
        ],
        examples: ['$ fleet join --token SWMTKN-1-xxx --address 10.0.0.1:2377'],
      },
      {
        name: 'fleet status',
        descriptionKey: 'docs.cmd.infrastructure.statusDesc',
        usage: 'fleet status',
        examples: ['$ fleet status'],
      },
    ],
  },
]
